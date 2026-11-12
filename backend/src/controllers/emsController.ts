import { Request, Response } from 'express';
import { poolPromise, sql } from '../config/db';

// ==========================================
// 1. DEPARTMENTS & DESIGNATIONS
// ==========================================

export const getDepartments = async (_req: Request, res: Response): Promise<void> => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT 
                d.id, 
                d.name, 
                d.code, 
                d.description, 
                d.created_at,
                COUNT(DISTINCT e.id) AS total_employees
            FROM ems_departments d
            LEFT JOIN ems_employees e ON d.id = e.department_id AND e.status = 'ACTIVE'
            GROUP BY d.id, d.name, d.code, d.description, d.created_at
            ORDER BY d.name ASC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const createDepartment = async (req: Request, res: Response): Promise<void> => {
    const { name, code, description } = req.body;
    if (!name || !code) {
        res.status(400).json({ success: false, message: 'Department name and code are required.' });
        return;
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('name', sql.NVarChar(100), name)
            .input('code', sql.NVarChar(20), code.toUpperCase())
            .input('description', sql.NVarChar(255), description || null)
            .query(`
                INSERT INTO ems_departments (name, code, description)
                OUTPUT INSERTED.*
                VALUES (@name, @code, @description)
            `);
        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const getDesignations = async (req: Request, res: Response): Promise<void> => {
    const { department_id } = req.query;

    try {
        const pool = await poolPromise;
        let query = `
            SELECT 
                des.id, 
                des.title, 
                des.grade_level, 
                des.department_id,
                dept.name AS department_name,
                dept.code AS department_code
            FROM ems_designations des
            JOIN ems_departments dept ON des.department_id = dept.id
        `;
        const request = pool.request();

        if (department_id) {
            query += ` WHERE des.department_id = @dept_id`;
            request.input('dept_id', sql.Int, Number(department_id));
        }

        query += ` ORDER BY dept.name, des.title`;
        const result = await request.query(query);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const createDesignation = async (req: Request, res: Response): Promise<void> => {
    const { department_id, title, grade_level } = req.body;
    if (!department_id || !title) {
        res.status(400).json({ success: false, message: 'Department ID and Title are required.' });
        return;
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('dept_id', sql.Int, department_id)
            .input('title', sql.NVarChar(100), title)
            .input('grade_level', sql.NVarChar(20), grade_level || null)
            .query(`
                INSERT INTO ems_designations (department_id, title, grade_level)
                OUTPUT INSERTED.*
                VALUES (@dept_id, @title, @grade_level)
            `);
        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ==========================================
// 2. EMPLOYEES DIRECTORY & ONBOARDING (LMS SYNC)
// ==========================================

export const getEmployees = async (req: Request, res: Response): Promise<void> => {
    const { department_id, status, search } = req.query;

    try {
        const pool = await poolPromise;
        let query = `
            SELECT 
                e.id,
                e.user_id,
                e.employee_code,
                u.name,
                u.mobile_number,
                u.role AS user_role,
                e.work_email,
                e.employment_type,
                e.status,
                e.date_of_joining,
                e.salary_monthly,
                d.id AS department_id,
                d.name AS department_name,
                d.code AS department_code,
                des.id AS designation_id,
                des.title AS designation_title,
                des.grade_level,
                m.name AS reporting_manager_name,
                (
                    SELECT COUNT(*) 
                    FROM ems_employee_trainings et 
                    WHERE et.employee_id = e.id
                ) AS enrolled_trainings_count,
                (
                    SELECT c.course_name 
                    FROM ems_employee_trainings et
                    JOIN courses c ON et.course_id = c.id
                    WHERE et.employee_id = e.id
                    ORDER BY et.id DESC
                    LIMIT 1
                ) AS current_course_name
            FROM ems_employees e
            JOIN users u ON e.user_id = u.id
            JOIN ems_departments d ON e.department_id = d.id
            JOIN ems_designations des ON e.designation_id = des.id
            LEFT JOIN ems_employees mgr_emp ON e.reporting_manager_id = mgr_emp.id
            LEFT JOIN users m ON mgr_emp.user_id = m.id
            WHERE 1=1
        `;

        const request = pool.request();

        if (department_id) {
            query += ` AND e.department_id = @dept_id`;
            request.input('dept_id', sql.Int, Number(department_id));
        }

        if (status) {
            query += ` AND e.status = @status`;
            request.input('status', sql.NVarChar(30), String(status));
        }

        if (search) {
            query += ` AND (u.name LIKE @search OR e.employee_code LIKE @search OR e.work_email LIKE @search OR u.mobile_number LIKE @search)`;
            request.input('search', sql.NVarChar(100), `%${search}%`);
        }

        query += ` ORDER BY e.id DESC`;

        const result = await request.query(query);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const getEmployeeById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
        const pool = await poolPromise;

        // Employee Info
        const empResult = await pool.request()
            .input('id', sql.Int, Number(id))
            .query(`
                SELECT 
                    e.*,
                    u.name,
                    u.mobile_number,
                    u.role AS user_role,
                    d.name AS department_name,
                    d.code AS department_code,
                    des.title AS designation_title,
                    des.grade_level,
                    m.name AS reporting_manager_name
                FROM ems_employees e
                JOIN users u ON e.user_id = u.id
                JOIN ems_departments d ON e.department_id = d.id
                JOIN ems_designations des ON e.designation_id = des.id
                LEFT JOIN ems_employees mgr_emp ON e.reporting_manager_id = mgr_emp.id
                LEFT JOIN users m ON mgr_emp.user_id = m.id
                WHERE e.id = @id
            `);

        if (empResult.recordset.length === 0) {
            res.status(404).json({ success: false, message: 'Employee not found' });
            return;
        }

        const employee = empResult.recordset[0];

        // Enrolled LMS Trainings
        const trainingsResult = await pool.request()
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
                ORDER BY et.id DESC
            `);

        // Recent Attendance (Last 10 days)
        const attendanceResult = await pool.request()
            .input('emp_id', sql.Int, Number(id))
            .query(`
                SELECT * 
                FROM ems_attendance 
                WHERE employee_id = @emp_id 
                ORDER BY attendance_date DESC
                LIMIT 10
            `);

        // Leave Requests
        const leavesResult = await pool.request()
            .input('emp_id', sql.Int, Number(id))
            .query(`
                SELECT * 
                FROM ems_leaves 
                WHERE employee_id = @emp_id 
                ORDER BY from_date DESC
                LIMIT 10
            `);

        res.json({
            success: true,
            data: {
                ...employee,
                trainings: trainingsResult.recordset,
                recent_attendance: attendanceResult.recordset,
                recent_leaves: leavesResult.recordset
            }
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Onboard a new Employee (Transactional: creates User + Student Profile + EMS Employee + optional Initial LMS Training)
 */
export const createEmployee = async (req: Request, res: Response): Promise<void> => {
    const {
        name,
        mobile_number,
        work_email,
        department_id,
        designation_id,
        reporting_manager_id,
        employment_type = 'FULL_TIME',
        status = 'ACTIVE',
        date_of_joining,
        salary_monthly = 0,
        emergency_contact,
        address,
        initial_course_id,
        initial_batch_id
    } = req.body;

    if (!name || !mobile_number || !department_id || !designation_id) {
        res.status(400).json({
            success: false,
            message: 'Name, mobile_number, department_id, and designation_id are required.'
        });
        return;
    }

    const pool = await poolPromise;
    const transaction = pool.transaction();

    try {
        await transaction.begin();

        // 1. Check if user with mobile_number already exists
        const userCheck = await transaction.request()
            .input('mobile', sql.VarChar(15), mobile_number)
            .query('SELECT id, role FROM users WHERE mobile_number = @mobile');

        let userId: number;

        if (userCheck.recordset.length > 0) {
            userId = userCheck.recordset[0].id;
            // Check if employee already exists for this user
            const empCheck = await transaction.request()
                .input('user_id', sql.Int, userId)
                .query('SELECT id FROM ems_employees WHERE user_id = @user_id');

            if (empCheck.recordset.length > 0) {
                await transaction.rollback();
                res.status(400).json({
                    success: false,
                    message: `An employee profile already exists for mobile number ${mobile_number}.`
                });
                return;
            }
        } else {
            // Create user with EMPLOYEE role
            const userInsert = await transaction.request()
                .input('name', sql.VarChar(100), name)
                .input('mobile', sql.VarChar(15), mobile_number)
                .input('role', sql.VarChar(20), 'EMPLOYEE')
                .query(`
                    INSERT INTO users (name, mobile_number, role)
                    OUTPUT INSERTED.id
                    VALUES (@name, @mobile, @role)
                `);
            userId = userInsert.recordset[0].id;
        }

        // 2. Ensure an LMS student profile exists so employee can use LMS classroom
        const studentCheck = await transaction.request()
            .input('user_id', sql.Int, userId)
            .query('SELECT student_id FROM students WHERE user_id = @user_id');

        let studentId: number;
        if (studentCheck.recordset.length === 0) {
            const studentInsert = await transaction.request()
                .input('user_id', sql.Int, userId)
                .input('joining_date', sql.Date, date_of_joining || new Date().toISOString().split('T')[0])
                .input('cert_status', sql.VarChar(50), 'PENDING')
                .query(`
                    INSERT INTO students (user_id, joining_date, certification_status)
                    OUTPUT INSERTED.student_id
                    VALUES (@user_id, @joining_date, @cert_status)
                `);
            studentId = studentInsert.recordset[0].student_id;
        } else {
            studentId = studentCheck.recordset[0].student_id;
        }

        // 3. Generate Unique Employee Code: EMP-{DEPT_CODE}-{YEAR}-{AUTO_ID}
        const deptResult = await transaction.request()
            .input('dept_id', sql.Int, department_id)
            .query('SELECT code FROM ems_departments WHERE id = @dept_id');
        const deptCode = deptResult.recordset[0]?.code || 'ORG';
        const year = new Date().getFullYear();

        const countResult = await transaction.request()
            .query('SELECT COUNT(*) AS total FROM ems_employees');
        const nextNum = (countResult.recordset[0].total + 1).toString().padStart(3, '0');
        const employeeCode = `EMP-${deptCode}-${year}-${nextNum}`;

        // 4. Insert into ems_employees
        const empInsert = await transaction.request()
            .input('user_id', sql.Int, userId)
            .input('employee_code', sql.NVarChar(50), employeeCode)
            .input('department_id', sql.Int, department_id)
            .input('designation_id', sql.Int, designation_id)
            .input('reporting_manager_id', sql.Int, reporting_manager_id || null)
            .input('employment_type', sql.NVarChar(30), employment_type)
            .input('status', sql.NVarChar(30), status)
            .input('date_of_joining', sql.Date, date_of_joining || new Date().toISOString().split('T')[0])
            .input('work_email', sql.NVarChar(150), work_email || null)
            .input('emergency_contact', sql.NVarChar(50), emergency_contact || null)
            .input('address', sql.NVarChar(sql.MAX), address || null)
            .input('salary_monthly', sql.Decimal(12, 2), salary_monthly || 0)
            .query(`
                INSERT INTO ems_employees (
                    user_id, employee_code, department_id, designation_id,
                    reporting_manager_id, employment_type, status, date_of_joining,
                    work_email, emergency_contact, address, salary_monthly
                )
                OUTPUT INSERTED.*
                VALUES (
                    @user_id, @employee_code, @department_id, @designation_id,
                    @reporting_manager_id, @employment_type, @status, @date_of_joining,
                    @work_email, @emergency_contact, @address, @salary_monthly
                )
            `);

        const newEmployee = empInsert.recordset[0];

        // 5. Optional: Auto-enroll in initial LMS batch/course
        if (initial_course_id) {
            await transaction.request()
                .input('emp_id', sql.Int, newEmployee.id)
                .input('course_id', sql.Int, initial_course_id)
                .input('batch_id', sql.Int, initial_batch_id || null)
                .input('type', sql.NVarChar(50), 'ONBOARDING')
                .query(`
                    INSERT INTO ems_employee_trainings (employee_id, course_id, batch_id, training_type)
                    VALUES (@emp_id, @course_id, @batch_id, @type)
                `);

            if (initial_batch_id && studentId) {
                // Also enroll in batch_students so LMS views show the batch
                await transaction.request()
                    .input('batch_id', sql.Int, initial_batch_id)
                    .input('student_id', sql.Int, studentId)
                    .query(`
                    INSERT IGNORE INTO batch_students (batch_id, student_id)
                    VALUES (@batch_id, @student_id)
                `);
            }
        }

        await transaction.commit();

        res.status(201).json({
            success: true,
            message: 'Employee created and provisioned with LMS access successfully',
            data: {
                ...newEmployee,
                name,
                mobile_number,
                student_id: studentId
            }
        });
    } catch (err: any) {
        if (transaction) await transaction.rollback();
        res.status(500).json({ success: false, error: err.message });
    }
};

export const updateEmployee = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const {
        department_id,
        designation_id,
        reporting_manager_id,
        employment_type,
        status,
        work_email,
        emergency_contact,
        address,
        salary_monthly
    } = req.body;

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, Number(id))
            .input('department_id', sql.Int, department_id)
            .input('designation_id', sql.Int, designation_id)
            .input('reporting_manager_id', sql.Int, reporting_manager_id || null)
            .input('employment_type', sql.NVarChar(30), employment_type)
            .input('status', sql.NVarChar(30), status)
            .input('work_email', sql.NVarChar(150), work_email || null)
            .input('emergency_contact', sql.NVarChar(50), emergency_contact || null)
            .input('address', sql.NVarChar(sql.MAX), address || null)
            .input('salary_monthly', sql.Decimal(12, 2), salary_monthly)
            .query(`
                UPDATE ems_employees
                SET 
                    department_id = IFNULL(@department_id, department_id),
                    designation_id = IFNULL(@designation_id, designation_id),
                    reporting_manager_id = @reporting_manager_id,
                    employment_type = IFNULL(@employment_type, employment_type),
                    status = IFNULL(@status, status),
                    work_email = IFNULL(@work_email, work_email),
                    emergency_contact = IFNULL(@emergency_contact, emergency_contact),
                    address = IFNULL(@address, address),
                    salary_monthly = IFNULL(@salary_monthly, salary_monthly),
                    updated_at = NOW()
                OUTPUT INSERTED.*
                WHERE id = @id
            `);

        if (result.recordset.length === 0) {
            res.status(404).json({ success: false, message: 'Employee not found' });
            return;
        }

        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ==========================================
// 3. ATTENDANCE MANAGEMENT
// ==========================================

export const getAttendance = async (req: Request, res: Response): Promise<void> => {
    const { date, employee_id, department_id } = req.query;

    try {
        const pool = await poolPromise;
        let query = `
            SELECT 
                a.*,
                u.name AS employee_name,
                e.employee_code,
                d.name AS department_name,
                des.title AS designation_title
            FROM ems_attendance a
            JOIN ems_employees e ON a.employee_id = e.id
            JOIN users u ON e.user_id = u.id
            JOIN ems_departments d ON e.department_id = d.id
            JOIN ems_designations des ON e.designation_id = des.id
            WHERE 1=1
        `;

        const request = pool.request();

        if (date) {
            query += ` AND a.attendance_date = @date`;
            request.input('date', sql.Date, String(date));
        }

        if (employee_id) {
            query += ` AND a.employee_id = @emp_id`;
            request.input('emp_id', sql.Int, Number(employee_id));
        }

        if (department_id) {
            query += ` AND e.department_id = @dept_id`;
            request.input('dept_id', sql.Int, Number(department_id));
        }

        query += ` ORDER BY a.attendance_date DESC, u.name ASC`;

        const result = await request.query(query);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const checkIn = async (req: Request, res: Response): Promise<void> => {
    const { employee_id, work_mode = 'OFFICE', remarks } = req.body;
    if (!employee_id) {
        res.status(400).json({ success: false, message: 'employee_id is required' });
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toTimeString().split(' ')[0];

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('emp_id', sql.Int, employee_id)
            .input('today', sql.Date, today)
            .input('nowTime', sql.VarChar(8), nowTime)
            .input('work_mode', sql.NVarChar(20), work_mode)
            .input('remarks', sql.NVarChar(255), remarks || null)
            .query(`
                INSERT INTO ems_attendance (employee_id, attendance_date, check_in_time, status, work_mode, remarks)
                VALUES (@emp_id, @today, CAST(@nowTime AS TIME), 'PRESENT', @work_mode, @remarks)
                ON DUPLICATE KEY UPDATE
                    check_in_time = IFNULL(check_in_time, VALUES(check_in_time)),
                    work_mode = VALUES(work_mode),
                    remarks = IFNULL(@remarks, remarks)
            `);

        const result = await pool.request()
            .input('emp_id', sql.Int, employee_id)
            .input('today', sql.Date, today)
            .query(`
                SELECT *
                FROM ems_attendance
                WHERE employee_id = @emp_id AND attendance_date = @today
            `);

        res.json({ success: true, message: 'Check-in recorded', data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const checkOut = async (req: Request, res: Response): Promise<void> => {
    const { employee_id } = req.body;
    if (!employee_id) {
        res.status(400).json({ success: false, message: 'employee_id is required' });
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toTimeString().split(' ')[0];

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('emp_id', sql.Int, employee_id)
            .input('today', sql.Date, today)
            .input('nowTime', sql.VarChar(8), nowTime)
            .query(`
                UPDATE ems_attendance
                SET check_out_time = CAST(@nowTime AS TIME)
                OUTPUT INSERTED.*
                WHERE employee_id = @emp_id AND attendance_date = @today
            `);

        if (result.recordset.length === 0) {
            res.status(400).json({ success: false, message: 'No check-in record found for today.' });
            return;
        }

        res.json({ success: true, message: 'Check-out recorded', data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ==========================================
// 4. LEAVE MANAGEMENT
// ==========================================

export const getLeaves = async (req: Request, res: Response): Promise<void> => {
    const { status, employee_id } = req.query;

    try {
        const pool = await poolPromise;
        let query = `
            SELECT 
                l.*,
                u.name AS employee_name,
                e.employee_code,
                d.name AS department_name,
                des.title AS designation_title,
                approver_u.name AS approved_by_name
            FROM ems_leaves l
            JOIN ems_employees e ON l.employee_id = e.id
            JOIN users u ON e.user_id = u.id
            JOIN ems_departments d ON e.department_id = d.id
            JOIN ems_designations des ON e.designation_id = des.id
            LEFT JOIN ems_employees approver_emp ON l.approved_by = approver_emp.id
            LEFT JOIN users approver_u ON approver_emp.user_id = approver_u.id
            WHERE 1=1
        `;

        const request = pool.request();

        if (status) {
            query += ` AND l.status = @status`;
            request.input('status', sql.NVarChar(20), String(status));
        }

        if (employee_id) {
            query += ` AND l.employee_id = @emp_id`;
            request.input('emp_id', sql.Int, Number(employee_id));
        }

        query += ` ORDER BY l.id DESC`;

        const result = await request.query(query);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const applyLeave = async (req: Request, res: Response): Promise<void> => {
    const { employee_id, leave_type, from_date, to_date, total_days, reason } = req.body;

    if (!employee_id || !leave_type || !from_date || !to_date || !reason) {
        res.status(400).json({ success: false, message: 'All leave fields are required' });
        return;
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('emp_id', sql.Int, employee_id)
            .input('type', sql.NVarChar(30), leave_type)
            .input('from', sql.Date, from_date)
            .input('to', sql.Date, to_date)
            .input('days', sql.Decimal(4, 1), total_days || 1)
            .input('reason', sql.NVarChar(500), reason)
            .query(`
                INSERT INTO ems_leaves (employee_id, leave_type, from_date, to_date, total_days, reason, status)
                OUTPUT INSERTED.*
                VALUES (@emp_id, @type, @from, @to, @days, @reason, 'PENDING')
            `);

        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const updateLeaveStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { status, approved_by, action_remarks } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(status)) {
        res.status(400).json({ success: false, message: 'Status must be APPROVED or REJECTED' });
        return;
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, Number(id))
            .input('status', sql.NVarChar(20), status)
            .input('approved_by', sql.Int, approved_by || null)
            .input('remarks', sql.NVarChar(255), action_remarks || null)
            .query(`
                UPDATE ems_leaves
                SET 
                    status = @status,
                    approved_by = @approved_by,
                    action_remarks = @remarks
                OUTPUT INSERTED.*
                WHERE id = @id
            `);

        if (result.recordset.length === 0) {
            res.status(404).json({ success: false, message: 'Leave application not found' });
            return;
        }

        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};
