import { Request, Response } from 'express';
import { poolPromise, sql } from '../config/db';

/**
 * Assign an LMS Course & Batch to an Employee (The Bridge)
 */
export const assignTrainingToEmployee = async (req: Request, res: Response): Promise<void> => {
    const { employee_id, course_id, batch_id, training_type = 'ONBOARDING', completion_deadline } = req.body;

    if (!employee_id || !course_id) {
        res.status(400).json({ success: false, message: 'employee_id and course_id are required' });
        return;
    }

    try {
        const pool = await poolPromise;

        // 1. Get employee and user info
        const empResult = await pool.request()
            .input('emp_id', sql.Int, employee_id)
            .query(`
                SELECT e.id, e.user_id, s.student_id 
                FROM ems_employees e
                LEFT JOIN students s ON e.user_id = s.user_id
                WHERE e.id = @emp_id
            `);

        if (empResult.recordset.length === 0) {
            res.status(404).json({ success: false, message: 'Employee not found' });
            return;
        }

        const { user_id, student_id } = empResult.recordset[0];

        // 2. Ensure student profile exists
        let activeStudentId = student_id;
        if (!activeStudentId) {
            const studentInsert = await pool.request()
                .input('user_id', sql.Int, user_id)
                .input('joining_date', sql.Date, new Date().toISOString().split('T')[0])
                .input('cert_status', sql.VarChar(50), 'PENDING')
                .query(`
                    INSERT INTO students (user_id, joining_date, certification_status)
                    OUTPUT INSERTED.student_id
                    VALUES (@user_id, @joining_date, @cert_status)
                `);
            activeStudentId = studentInsert.recordset[0].student_id;
        }

        // 3. Upsert into ems_employee_trainings
        // MySQL treats NULL values as distinct inside UNIQUE keys, so the
        // "match including a NULL batch_id" case is resolved explicitly.
        const existingTraining = await pool.request()
            .input('emp_id', sql.Int, employee_id)
            .input('course_id', sql.Int, course_id)
            .input('batch_id', sql.Int, batch_id || null)
            .query(`
                SELECT id
                FROM ems_employee_trainings
                WHERE employee_id = @emp_id
                  AND course_id = @course_id
                  AND (batch_id = @batch_id OR (batch_id IS NULL AND @batch_id IS NULL))
                LIMIT 1
            `);

        let trainingResult;
        if (existingTraining.recordset.length > 0) {
            trainingResult = await pool.request()
                .input('id', sql.Int, existingTraining.recordset[0].id)
                .input('type', sql.NVarChar(50), training_type)
                .input('deadline', sql.Date, completion_deadline || null)
                .query(`
                    UPDATE ems_employee_trainings
                    SET training_type = @type, completion_deadline = @deadline
                    OUTPUT INSERTED.*
                    WHERE id = @id
                `);
        } else {
            trainingResult = await pool.request()
                .input('emp_id', sql.Int, employee_id)
                .input('course_id', sql.Int, course_id)
                .input('batch_id', sql.Int, batch_id || null)
                .input('type', sql.NVarChar(50), training_type)
                .input('deadline', sql.Date, completion_deadline || null)
                .query(`
                    INSERT INTO ems_employee_trainings (employee_id, course_id, batch_id, training_type, completion_deadline, status, progress_percentage)
                    OUTPUT INSERTED.*
                    VALUES (@emp_id, @course_id, @batch_id, @type, @deadline, 'ENROLLED', 0.00)
                `);
        }

        // 4. Enroll in batch_students so LMS student view activates the batch
        if (batch_id && activeStudentId) {
            await pool.request()
                .input('batch_id', sql.Int, batch_id)
                .input('student_id', sql.Int, activeStudentId)
                .query(`
                    INSERT IGNORE INTO batch_students (batch_id, student_id)
                    VALUES (@batch_id, @student_id)
                `);
        }

        res.status(201).json({
            success: true,
            message: 'Training assigned to employee successfully',
            data: trainingResult.recordset[0]
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Get detailed LMS Learning Analytics for an Employee
 */
export const getEmployeeLearningProgress = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params; // employee_id

    try {
        const pool = await poolPromise;

        // Get employee student profile
        const empStudentRes = await pool.request()
            .input('emp_id', sql.Int, Number(id))
            .query(`
                SELECT e.id AS employee_id, e.user_id, u.name, s.student_id
                FROM ems_employees e
                JOIN users u ON e.user_id = u.id
                LEFT JOIN students s ON e.user_id = s.user_id
                WHERE e.id = @emp_id
            `);

        if (empStudentRes.recordset.length === 0) {
            res.status(404).json({ success: false, message: 'Employee not found' });
            return;
        }

        const { student_id, name } = empStudentRes.recordset[0];

        // Fetch assigned trainings
        const trainingsRes = await pool.request()
            .input('emp_id', sql.Int, Number(id))
            .query(`
                SELECT 
                    et.*,
                    c.course_name,
                    c.duration_days,
                    b.batch_code,
                    b.start_date AS batch_start_date,
                    b.end_date AS batch_end_date
                FROM ems_employee_trainings et
                JOIN courses c ON et.course_id = c.id
                LEFT JOIN batches b ON et.batch_id = b.id
                WHERE et.employee_id = @emp_id
            `);

        const trainingsWithMetrics = await Promise.all(trainingsRes.recordset.map(async (training) => {
            let attendanceCount = 0;
            let totalSessions = 0;
            let assignmentsSubmitted = 0;
            let totalAssignments = 0;
            let testSubmissions = 0;
            let certIssued = false;

            if (training.batch_id && student_id) {
                // LMS Attendance in this batch
                const attRes = await pool.request()
                    .input('student_id', sql.Int, student_id)
                    .input('batch_id', sql.Int, training.batch_id)
                    .query(`
                        SELECT 
                            COUNT(*) AS total_records,
                            SUM(CASE WHEN status IN ('PRESENT_ONLINE', 'PRESENT_OFFLINE') THEN 1 ELSE 0 END) AS present_count
                        FROM attendance
                        WHERE student_id = @student_id AND batch_id = @batch_id
                    `);
                attendanceCount = attRes.recordset[0]?.present_count || 0;
                totalSessions = attRes.recordset[0]?.total_records || 0;

                // Assignments
                const assignRes = await pool.request()
                    .input('student_id', sql.Int, student_id)
                    .input('batch_id', sql.Int, training.batch_id)
                    .query(`
                        SELECT 
                            (SELECT COUNT(*) FROM assignments WHERE batch_id = @batch_id) AS total_assignments,
                            (SELECT COUNT(*) FROM assignment_submissions sub 
                             JOIN assignments a ON sub.assignment_id = a.id 
                             WHERE a.batch_id = @batch_id AND sub.student_id = @student_id) AS submitted_assignments
                    `);
                totalAssignments = assignRes.recordset[0]?.total_assignments || 0;
                assignmentsSubmitted = assignRes.recordset[0]?.submitted_assignments || 0;

                // Tests
                const testRes = await pool.request()
                    .input('student_id', sql.Int, student_id)
                    .input('batch_id', sql.Int, training.batch_id)
                    .query(`
                        SELECT COUNT(*) AS test_count
                        FROM test_submissions ts
                        JOIN tests t ON ts.test_id = t.id
                        WHERE t.batch_id = @batch_id AND ts.student_id = @student_id
                    `);
                testSubmissions = testRes.recordset[0]?.test_count || 0;

                // Certificate check
                const certRes = await pool.request()
                    .input('student_id', sql.Int, student_id)
                    .input('batch_id', sql.Int, training.batch_id)
                    .query(`
                        SELECT pdf_url, issued_at 
                        FROM certificates 
                        WHERE student_id = @student_id AND batch_id = @batch_id
                    `);
                if (certRes.recordset.length > 0) {
                    certIssued = true;
                }
            }

            const attendancePercentage = totalSessions > 0 ? Math.round((attendanceCount / totalSessions) * 100) : 0;
            const assignmentPercentage = totalAssignments > 0 ? Math.round((assignmentsSubmitted / totalAssignments) * 100) : 0;

            // Compute overall course progress
            const calculatedProgress = totalAssignments > 0
                ? Math.round((attendancePercentage * 0.5) + (assignmentPercentage * 0.5))
                : attendancePercentage;

            return {
                ...training,
                metrics: {
                    attendance_percentage: attendancePercentage,
                    attended_sessions: attendanceCount,
                    total_sessions: totalSessions,
                    assignments_submitted: assignmentsSubmitted,
                    total_assignments: totalAssignments,
                    tests_completed: testSubmissions,
                    certificate_issued: certIssued,
                    overall_progress: calculatedProgress
                }
            };
        }));

        res.json({
            success: true,
            data: {
                employee_id: Number(id),
                employee_name: name,
                trainings: trainingsWithMetrics
            }
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * HR / Admin Aggregate Training & Upskilling Analytics
 */
export const getOrganizationTrainingSummary = async (_req: Request, res: Response): Promise<void> => {
    try {
        const pool = await poolPromise;

        const summaryRes = await pool.request().query(`
            SELECT 
                COUNT(DISTINCT e.id) AS total_employees,
                COUNT(DISTINCT et.employee_id) AS employees_in_training,
                COUNT(DISTINCT et.id) AS total_training_enrollments,
                SUM(CASE WHEN et.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_trainings,
                SUM(CASE WHEN et.status IN ('ENROLLED', 'IN_PROGRESS') THEN 1 ELSE 0 END) AS active_trainings,
                SUM(CASE WHEN et.certification_issued = 1 THEN 1 ELSE 0 END) AS certificates_earned
            FROM ems_employees e
            LEFT JOIN ems_employee_trainings et ON e.id = et.employee_id
            WHERE e.status = 'ACTIVE'
        `);

        const deptBreakdownRes = await pool.request().query(`
            SELECT 
                d.name AS department_name,
                COUNT(DISTINCT e.id) AS department_headcount,
                COUNT(DISTINCT et.employee_id) AS employees_trained,
                AVG(IFNULL(et.progress_percentage, 0)) AS avg_progress
            FROM ems_departments d
            LEFT JOIN ems_employees e ON d.id = e.department_id AND e.status = 'ACTIVE'
            LEFT JOIN ems_employee_trainings et ON e.id = et.employee_id
            GROUP BY d.name
            ORDER BY department_headcount DESC
        `);

        res.json({
            success: true,
            data: {
                overview: summaryRes.recordset[0],
                department_breakdown: deptBreakdownRes.recordset
            }
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};
