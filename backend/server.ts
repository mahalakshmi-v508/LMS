import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import PDFDocument from 'pdfkit';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import emsRoutes from './src/routes/emsRoutes';
import { poolPromise, sql } from './src/config/db';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const certificateDirectory = path.join(process.cwd(), 'certificates');

const createCertificatePdf = (certificate: {
    certificateNumber: string;
    studentName: string;
    courseName: string;
    batchCode: string;
    issuedAt: Date;
}): Promise<Buffer> => new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 48 });
    const chunks: Buffer[] = [];

    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    const pageWidth = document.page.width;
    const pageHeight = document.page.height;
    document.lineWidth(3).strokeColor('#4338ca').rect(28, 28, pageWidth - 56, pageHeight - 56).stroke();
    document.lineWidth(1).strokeColor('#a5b4fc').rect(38, 38, pageWidth - 76, pageHeight - 76).stroke();
    document.fillColor('#4338ca').font('Helvetica-Bold').fontSize(18).text('CERTIFICATE OF COMPLETION', 60, 100, {
        align: 'center',
        characterSpacing: 2,
    });
    document.fillColor('#475569').font('Helvetica').fontSize(16).text('This certificate is proudly presented to', 70, 165, {
        align: 'center',
    });
    document.fillColor('#111827').font('Helvetica-Bold').fontSize(34).text(certificate.studentName, 70, 210, {
        align: 'center',
    });
    document.moveTo(180, 260).lineTo(pageWidth - 180, 260).strokeColor('#cbd5e1').lineWidth(1).stroke();
    document.fillColor('#475569').font('Helvetica').fontSize(16).text('for successfully completing', 70, 285, {
        align: 'center',
    });
    document.fillColor('#312e81').font('Helvetica-Bold').fontSize(25).text(certificate.courseName, 70, 320, {
        align: 'center',
    });
    document.fillColor('#475569').font('Helvetica').fontSize(13).text(`Batch: ${certificate.batchCode}`, 70, 365, {
        align: 'center',
    });
    document.fillColor('#334155').font('Helvetica').fontSize(12)
        .text(`Issued: ${certificate.issuedAt.toLocaleDateString()}`, 90, pageHeight - 120)
        .text(`Certificate No: ${certificate.certificateNumber}`, pageWidth - 300, pageHeight - 120, {
            width: 210,
            align: 'right',
        });
    document.end();
});

interface CertificateRow {
    id: number;
    certificate_number: string;
    student_id: number;
    batch_id: number;
    issued_at: Date | string;
    pdf_url: string | null;
    recipient_name: string | null;
    course_title: string | null;
    batch_label: string | null;
    student_name: string;
    course_name: string;
    batch_code: string;
}

const certificateSelect = `
    SELECT cert.id, cert.certificate_number, cert.student_id, cert.batch_id, cert.issued_at, cert.pdf_url,
           cert.recipient_name, cert.course_title, cert.batch_label,
           u.name AS student_name, c.course_name, b.batch_code
    FROM certificates cert
    INNER JOIN students s ON cert.student_id = s.student_id
    INNER JOIN users u ON s.user_id = u.id
    INNER JOIN batches b ON cert.batch_id = b.id
    INNER JOIN courses c ON b.course_id = c.id
`;

// The PDF shows the editable values when set, otherwise the student's real data.
const resolveCertificateText = (row: CertificateRow) => ({
    recipientName: (row.recipient_name || '').trim() || row.student_name,
    courseTitle: (row.course_title || '').trim() || row.course_name,
    batchLabel: (row.batch_label || '').trim() || row.batch_code,
});

const certificateResponse = (row: CertificateRow) => {
    const text = resolveCertificateText(row);
    const issuedAt = row.issued_at instanceof Date ? row.issued_at : new Date(row.issued_at);
    return {
        id: row.id,
        certificate_number: row.certificate_number,
        student_id: row.student_id,
        batch_id: row.batch_id,
        issued_at: issuedAt,
        pdf_url: row.pdf_url,
        recipient_name: text.recipientName,
        course_title: text.courseTitle,
        batch_label: text.batchLabel,
        default_recipient_name: row.student_name,
        default_course_title: row.course_name,
        default_batch_label: row.batch_code,
    };
};

const loadCertificateById = async (pool: Awaited<typeof poolPromise>, certificateId: number): Promise<CertificateRow | null> => {
    const result = await pool.request()
        .input('id', sql.Int, certificateId)
        .query(`${certificateSelect} WHERE cert.id = @id`);
    return result.recordset.length > 0 ? (result.recordset[0] as CertificateRow) : null;
};

// (Re)writes certificate-<id>.pdf from whatever is stored in the database.
const writeCertificatePdf = async (row: CertificateRow): Promise<string> => {
    const text = resolveCertificateText(row);
    const issuedAt = row.issued_at instanceof Date ? row.issued_at : new Date(row.issued_at);
    const pdf = await createCertificatePdf({
        certificateNumber: row.certificate_number,
        studentName: text.recipientName,
        courseName: text.courseTitle,
        batchCode: text.batchLabel,
        issuedAt,
    });
    await mkdir(certificateDirectory, { recursive: true });
    await writeFile(path.join(certificateDirectory, `certificate-${row.id}.pdf`), pdf);
    return `/api/certificates/${row.id}/download`;
};

const sendCertificatePdf = async (
    res: Response,
    row: CertificateRow,
    disposition: 'inline' | 'attachment',
    pool: Awaited<typeof poolPromise>,
) => {
    const filePath = path.join(certificateDirectory, `certificate-${row.id}.pdf`);
    // Older rows may point at a PDF that was never written - rebuild it on demand.
    if (!existsSync(filePath)) {
        const pdfUrl = await writeCertificatePdf(row);
        if (row.pdf_url !== pdfUrl) {
            await pool.request()
                .input('certificate_id', sql.Int, row.id)
                .input('pdf_url', sql.NVarChar(500), pdfUrl)
                .query('UPDATE certificates SET pdf_url = @pdf_url WHERE id = @certificate_id');
        }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${row.certificate_number}.pdf"`);
    res.sendFile(filePath, (error) => {
        if (error && !res.headersSent) {
            res.status(404).json({ success: false, message: 'Certificate PDF file is unavailable' });
        }
    });
};

// Download (attachment) - used by the "Download PDF" buttons
app.get('/api/certificates/:id/download', async (req, res) => {
    const certificateId = Number(req.params.id);
    if (!Number.isInteger(certificateId) || certificateId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid certificate ID' });
        return;
    }

    try {
        const pool = await poolPromise;
        const row = await loadCertificateById(pool, certificateId);
        if (!row) {
            res.status(404).json({ success: false, message: 'Certificate PDF not found' });
            return;
        }
        await sendCertificatePdf(res, row, 'attachment', pool);
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// View (inline) - used by the in-app preview modal / new tab
app.get('/api/certificates/:id/view', async (req, res) => {
    const certificateId = Number(req.params.id);
    if (!Number.isInteger(certificateId) || certificateId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid certificate ID' });
        return;
    }

    try {
        const pool = await poolPromise;
        const row = await loadCertificateById(pool, certificateId);
        if (!row) {
            res.status(404).json({ success: false, message: 'Certificate PDF not found' });
            return;
        }
        await sendCertificatePdf(res, row, 'inline', pool);
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Certificate details (used to prefill the edit form)
app.get('/api/certificates/:id', async (req, res) => {
    const certificateId = Number(req.params.id);
    if (!Number.isInteger(certificateId) || certificateId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid certificate ID' });
        return;
    }

    try {
        const pool = await poolPromise;
        const row = await loadCertificateById(pool, certificateId);
        if (!row) {
            res.status(404).json({ success: false, message: 'Certificate not found' });
            return;
        }
        res.json({ success: true, data: certificateResponse(row) });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Mount EMS (Employee Management System) Unified Routes
app.use('/api/ems', emsRoutes);

// Interface for User Input
interface CreateUserRequestBody {
    name: string;
    mobile_number: string;
    role: 'ADMIN' | 'TRAINER' | 'STUDENT';
}

// GET: Fetch all users
app.get('/api/users', async (_req: Request, res: Response): Promise<void> => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM users');
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        const error = err as Error;
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get students with profile, batch, and course information for admin management
app.get('/api/admin/students', async (_req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT
                s.student_id,
                s.user_id,
                s.joining_date,
                s.certification_status,
                u.name,
                u.mobile_number,
                u.is_active,
                b.id AS batch_id,
                b.batch_code,
                c.id AS course_id,
                c.course_name
            FROM students s
            INNER JOIN users u ON s.user_id = u.id
            LEFT JOIN batch_students bs_latest ON bs_latest.id = (
                SELECT bs2.id
                FROM batch_students bs2
                WHERE bs2.student_id = s.student_id
                ORDER BY bs2.assigned_at DESC, bs2.id DESC
                LIMIT 1
            )
            LEFT JOIN batches b ON b.id = bs_latest.batch_id
            LEFT JOIN courses c ON b.course_id = c.id
            WHERE UPPER(u.role) = 'STUDENT'
            ORDER BY u.name ASC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST: Create a new user
app.post('/api/users', async (req: Request<{}, {}, CreateUserRequestBody>, res: Response): Promise<void> => {
    const { name, mobile_number, role } = req.body;

    try {
        const pool = await poolPromise;
        const existingUser = await pool.request()
            .input('mobile', sql.VarChar(15), mobile_number)
            .query('SELECT id FROM users WHERE mobile_number = @mobile');

        if (existingUser.recordset.length > 0) {
            res.status(409).json({
                success: false,
                message: `A user with mobile number ${mobile_number} already exists.`
            });
            return;
        }

        const result = await pool.request()
            .input('name', sql.VarChar(100), name)
            .input('mobile', sql.VarChar(15), mobile_number)
            .input('role', sql.VarChar(20), role)
            .query(`
                INSERT INTO users (name, mobile_number, role)
                OUTPUT INSERTED.*
                VALUES (@name, @mobile, @role)
            `);

        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err) {
        const error = err as Error;
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create Student Profile
app.post('/api/students', async (req, res) => {
    const { user_id, joining_date, certification_status } = req.body;

    try {
        const pool = await poolPromise;

        // Step 1: Check if the referenced user actually exists in the users table
        const userCheck = await pool.request()
            .input('user_id', sql.Int, user_id)
            .query('SELECT id, role FROM users WHERE id = @user_id');

        if (userCheck.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: `User with id ${user_id} does not exist. Please create the user first.`
            });
        }
        if (userCheck.recordset[0].role?.toUpperCase() !== 'STUDENT') {
            return res.status(400).json({
                success: false,
                message: 'A student profile can only be created for a user with the STUDENT role.'
            });
        }
        // Step 2: Check if this user already has an active student profile
        const existingStudent = await pool.request()
            .input('user_id', sql.Int, user_id)
            .query('SELECT student_id FROM students WHERE user_id = @user_id');

        if (existingStudent.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `A student profile already exists for user_id ${user_id}.`
            });
        }

        // Step 3: Insert new student profile if validation passes
        const result = await pool.request()
            .input('user_id', sql.Int, user_id)
            .input('joining_date', sql.Date, joining_date)
            .input('certification_status', sql.VarChar(50), certification_status || 'PENDING')
            .query(`
                INSERT INTO students (user_id, joining_date, certification_status)
                OUTPUT INSERTED.*
                VALUES (@user_id, @joining_date, @certification_status)
            `);

        res.status(201).json({ success: true, data: result.recordset[0] });

    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Update student identity, profile status, and certification status
app.put('/api/students/:id', async (req, res) => {
    const studentId = req.params.id;
    const { name, mobile_number, joining_date, certification_status, is_active } = req.body;

    try {
        const pool = await poolPromise;
        const student = await pool.request()
            .input('student_id', sql.Int, studentId)
            .query('SELECT user_id FROM students WHERE student_id = @student_id');

        if (student.recordset.length === 0) {
            res.status(404).json({ success: false, message: 'Student not found' });
            return;
        }

        const userId = student.recordset[0].user_id;
        await pool.request()
            .input('user_id', sql.Int, userId)
            .input('name', sql.VarChar(100), name)
            .input('mobile', sql.VarChar(15), mobile_number)
            .input('is_active', sql.Bit, is_active)
            .query(`
                UPDATE users
                SET name = @name, mobile_number = @mobile, is_active = @is_active
                WHERE id = @user_id
            `);

        const result = await pool.request()
            .input('student_id', sql.Int, studentId)
            .input('joining_date', sql.Date, joining_date)
            .input('certification_status', sql.VarChar(50), certification_status)
            .query(`
                UPDATE students
                SET joining_date = @joining_date,
                    certification_status = @certification_status
                OUTPUT INSERTED.*
                WHERE student_id = @student_id
            `);

        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Assign, change, or remove a student's batch
app.put('/api/students/:id/batch', async (req, res) => {
    const studentId = req.params.id;
    const { batch_id } = req.body;

    try {
        const pool = await poolPromise;
        if (!batch_id) {
            await pool.request()
                .input('student_id', sql.Int, studentId)
                .query('DELETE FROM batch_students WHERE student_id = @student_id');
            res.json({ success: true, message: 'Student removed from batch successfully' });
            return;
        }

        const batch = await pool.request()
            .input('batch_id', sql.Int, batch_id)
            .query('SELECT id FROM batches WHERE id = @batch_id AND is_active = 1');
        if (batch.recordset.length === 0) {
            res.status(404).json({ success: false, message: 'Active batch not found' });
            return;
        }

        await pool.request()
            .input('student_id', sql.Int, studentId)
            .query('DELETE FROM batch_students WHERE student_id = @student_id');

        await pool.request()
            .input('batch_id', sql.Int, batch_id)
            .input('student_id', sql.Int, studentId)
            .query('INSERT INTO batch_students (batch_id, student_id) VALUES (@batch_id, @student_id)');

        res.json({ success: true, message: 'Student batch updated successfully' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get student profile and performance details for admin
app.get('/api/students/:id/admin-details', async (req, res) => {
    try {
        const pool = await poolPromise;
        const student = await pool.request()
            .input('student_id', sql.Int, req.params.id)
            .query(`
                SELECT s.student_id, s.user_id, s.joining_date, s.certification_status,
                       u.name, u.mobile_number, u.is_active,
                       b.id AS batch_id, b.batch_code, c.course_name
                FROM students s
                INNER JOIN users u ON s.user_id = u.id
                LEFT JOIN batch_students bs_latest ON bs_latest.id = (
                    SELECT bs2.id
                    FROM batch_students bs2
                    WHERE bs2.student_id = s.student_id
                    ORDER BY bs2.assigned_at DESC, bs2.id DESC
                    LIMIT 1
                )
                LEFT JOIN batches b ON b.id = bs_latest.batch_id
                LEFT JOIN courses c ON b.course_id = c.id
                WHERE s.student_id = @student_id
            `);

        if (student.recordset.length === 0) {
            res.status(404).json({ success: false, message: 'Student not found' });
            return;
        }

        const attendance = await pool.request()
            .input('student_id', sql.Int, req.params.id)
            .query(`
                SELECT a.*, b.batch_code
                FROM attendance a
                INNER JOIN batches b ON a.batch_id = b.id
                WHERE a.student_id = @student_id
                ORDER BY a.class_date DESC
            `);
        const assignments = await pool.request()
            .input('student_id', sql.Int, req.params.id)
            .query(`
                SELECT a.id, a.title, a.due_date, sub.submitted_at, sub.marks_obtained
                FROM assignments a
                INNER JOIN batch_students bs ON a.batch_id = bs.batch_id
                LEFT JOIN assignment_submissions sub
                    ON sub.assignment_id = a.id AND sub.student_id = @student_id
                WHERE bs.student_id = @student_id
                ORDER BY a.due_date DESC
            `);
        const tests = await pool.request()
            .input('student_id', sql.Int, req.params.id)
            .query(`
                SELECT t.id, t.title, t.total_marks, sub.submitted_at, sub.marks_obtained
                FROM tests t
                INNER JOIN batch_students bs ON t.batch_id = bs.batch_id
                LEFT JOIN test_submissions sub
                    ON sub.test_id = t.id AND sub.student_id = @student_id
                WHERE bs.student_id = @student_id
                ORDER BY t.start_time DESC
            `);
        const certificates = await pool.request()
            .input('student_id', sql.Int, req.params.id)
            .query(`${certificateSelect} WHERE cert.student_id = @student_id ORDER BY cert.issued_at DESC`);

        res.json({
            success: true,
            data: {
                profile: student.recordset[0],
                attendance: attendance.recordset,
                assignments: assignments.recordset,
                tests: tests.recordset,
                certificates: certificates.recordset.map((row: CertificateRow) => certificateResponse(row)),
            }
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Fetch Student Profile with Joined User Data
// Fetch Student Profile by Student ID
app.get('/api/students/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT s.student_id, s.joining_date, s.certification_status, 
                       u.id AS user_id, u.name, u.mobile_number, u.role, u.is_active
                FROM students s
                INNER JOIN users u ON s.user_id = u.id
                WHERE s.student_id = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create Trainer Profile
app.post('/api/trainers', async (req, res) => {
    const { user_id, specialization } = req.body;
    try {
        const pool = await poolPromise;

        // Check if user exists first
        const userCheck = await pool.request()
            .input('user_id', sql.Int, user_id)
            .query('SELECT id FROM users WHERE id = @user_id');

        if (userCheck.recordset.length === 0) {
            return res.status(404).json({ success: false, message: `User with id ${user_id} does not exist.` });
        }

        // Check if trainer profile already exists
        const existingTrainer = await pool.request()
            .input('user_id', sql.Int, user_id)
            .query('SELECT trainer_id FROM trainers WHERE user_id = @user_id');

        if (existingTrainer.recordset.length > 0) {
            return res.status(400).json({ success: false, message: `Trainer profile already exists for user_id ${user_id}` });
        }

        // Create trainer profile
        const result = await pool.request()
            .input('user_id', sql.Int, user_id)
            .input('specialization', sql.VarChar(100), specialization)
            .query(`
                INSERT INTO trainers (user_id, specialization)
                OUTPUT INSERTED.*
                VALUES (@user_id, @specialization)
            `);

        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Fetch Trainer Profile by Trainer ID
app.get('/api/trainers/:id', async (req, res) => {
    const trainerId = req.params.id;

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, trainerId)
            .query(`
                SELECT 
                    t.trainer_id, 
                    t.specialization, 
                    u.id AS user_id, 
                    u.name, 
                    u.mobile_number, 
                    u.role, 
                    u.is_active
                FROM trainers t
                INNER JOIN users u ON t.user_id = u.id
                WHERE t.trainer_id = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Trainer with ID ${trainerId} not found.`
            });
        }

        res.json({ success: true, data: result.recordset[0] });

    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Update trainer identity, specialization, and active status
app.put('/api/trainers/:id', async (req, res) => {
    const trainerId = req.params.id;
    const { name, mobile_number, specialization, is_active } = req.body;
    try {
        const pool = await poolPromise;
        const trainer = await pool.request()
            .input('trainer_id', sql.Int, trainerId)
            .query('SELECT user_id FROM trainers WHERE trainer_id = @trainer_id');
        if (trainer.recordset.length === 0) {
            res.status(404).json({ success: false, message: 'Trainer not found' });
            return;
        }

        await pool.request()
            .input('user_id', sql.Int, trainer.recordset[0].user_id)
            .input('name', sql.VarChar(100), name)
            .input('mobile', sql.VarChar(15), mobile_number)
            .input('is_active', sql.Bit, is_active)
            .query(`
                UPDATE users
                SET name = @name, mobile_number = @mobile, is_active = @is_active
                WHERE id = @user_id
            `);
        const result = await pool.request()
            .input('trainer_id', sql.Int, trainerId)
            .input('specialization', sql.VarChar(100), specialization)
            .query(`
                UPDATE trainers
                SET specialization = @specialization
                OUTPUT INSERTED.*
                WHERE trainer_id = @trainer_id
            `);
        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Fetch All Active Trainers
app.get('/api/trainers', async (req, res) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();
        const includeInactive = req.query.include_inactive === '1';
        request.input('include_inactive', sql.Bit, includeInactive);
        const result = await request.query(`
            SELECT 
                t.trainer_id, 
                t.specialization, 
                u.id AS user_id, 
                u.name, 
                u.mobile_number, 
                u.role, 
                u.is_active
            FROM trainers t
            INNER JOIN users u ON t.user_id = u.id
            WHERE (@include_inactive = 1 OR u.is_active = 1)
        `);

        res.json({ success: true, data: result.recordset });

    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create Course
app.post('/api/courses', async (req, res) => {
    const { course_name, description, duration_days, course_image_url } = req.body;

    // Step 1: Basic validation
    if (!course_name) {
        return res.status(400).json({
            success: false,
            message: 'Course name is required.'
        });
    }

    try {
        const pool = await poolPromise;

        // Step 2: Check if course name already exists
        const existingCourse = await pool.request()
            .input('course_name', sql.VarChar(150), course_name)
            .query('SELECT id FROM courses WHERE course_name = @course_name');

        if (existingCourse.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Course with name '${course_name}' already exists.`
            });
        }

        // Step 3: Insert new course
        const result = await pool.request()
            .input('course_name', sql.VarChar(150), course_name)
            .input('description', sql.NVarChar(sql.MAX), description || null)
            .input('duration_days', sql.Int, duration_days || 60)
            .input('course_image_url', sql.NVarChar(sql.MAX), course_image_url || null)
            .query(`
                INSERT INTO courses (course_name, description, duration_days, course_image_url)
                OUTPUT INSERTED.*
                VALUES (@course_name, @description, @duration_days, @course_image_url)
            `);

        res.status(201).json({ success: true, data: result.recordset[0] });

    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Fetch All Courses
app.get('/api/courses', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM courses WHERE is_active = 1');
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create Batch
app.post('/api/batches', async (req, res) => {
    const { batch_code, course_id, trainer_id, start_date, end_date } = req.body;

    // 1. Check for required input fields
    if (!batch_code || !course_id || !trainer_id || !start_date || !end_date) {
        return res.status(400).json({
            success: false,
            message: 'All fields (batch_code, course_id, trainer_id, start_date, end_date) are required.'
        });
    }

    try {
        const pool = await poolPromise;

        // 2. Validate course existence (Querying 'id' column in courses table)
        const courseCheck = await pool.request()
            .input('course_id', sql.Int, course_id)
            .query('SELECT id FROM courses WHERE id = @course_id');

        if (courseCheck.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Course with ID ${course_id} does not exist.`
            });
        }

        // 3. Validate trainer existence (Querying 'trainer_id' in trainers table)
        const trainerCheck = await pool.request()
            .input('trainer_id', sql.Int, trainer_id)
            .query('SELECT trainer_id FROM trainers WHERE trainer_id = @trainer_id');

        if (trainerCheck.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Trainer with ID ${trainer_id} does not exist.`
            });
        }

        // 4. Check for duplicate batch code
        const existingBatch = await pool.request()
            .input('batch_code', sql.VarChar(50), batch_code)
            .query('SELECT id FROM batches WHERE batch_code = @batch_code');

        if (existingBatch.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Batch code '${batch_code}' already exists.`
            });
        }

        // 5. Insert new batch
        const result = await pool.request()
            .input('batch_code', sql.VarChar(50), batch_code)
            .input('course_id', sql.Int, course_id)
            .input('trainer_id', sql.Int, trainer_id)
            .input('start_date', sql.Date, start_date)
            .input('end_date', sql.Date, end_date)
            .query(`
                INSERT INTO batches (batch_code, course_id, trainer_id, start_date, end_date)
                OUTPUT INSERTED.id, INSERTED.batch_code, INSERTED.course_id, INSERTED.trainer_id, INSERTED.start_date, INSERTED.end_date
                VALUES (@batch_code, @course_id, @trainer_id, @start_date, @end_date)
            `);

        res.status(201).json({ success: true, data: result.recordset[0] });

    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Update batch status
app.put('/api/batches/:id/status', async (req, res) => {
    const { is_active } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, req.params.id)
            .input('is_active', sql.Bit, is_active)
            .query(`
                UPDATE batches
                SET is_active = @is_active
                OUTPUT INSERTED.*
                WHERE id = @batch_id
            `);
        if (result.recordset.length === 0) {
            res.status(404).json({ success: false, message: 'Batch not found' });
            return;
        }
        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Remove students from a batch
app.delete('/api/batches/:id/students', async (req, res) => {
    const { student_ids } = req.body;
    if (!Array.isArray(student_ids) || student_ids.length === 0) {
        res.status(400).json({ success: false, message: 'student_ids must be a non-empty array' });
        return;
    }
    try {
        const pool = await poolPromise;
        for (const studentId of student_ids) {
            await pool.request()
                .input('batch_id', sql.Int, req.params.id)
                .input('student_id', sql.Int, studentId)
                .query('DELETE FROM batch_students WHERE batch_id = @batch_id AND student_id = @student_id');
        }
        res.json({ success: true, message: 'Students removed from batch successfully' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

//assign batch to student
app.post('/api/batches/assign-student', async (req, res) => {
    const { batch_id, student_ids } = req.body;

    // 1. Ensure student_ids is passed as a non-empty array
    if (!batch_id || !Array.isArray(student_ids) || student_ids.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Both batch_id and a non-empty student_ids array are required.'
        });
    }

    try {
        const pool = await poolPromise;

        // 2. Validate batch existence
        const batchCheck = await pool.request()
            .input('batch_id', sql.Int, batch_id)
            .query('SELECT id FROM batches WHERE id = @batch_id');

        if (batchCheck.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Batch with ID ${batch_id} does not exist.`
            });
        }

        const assigned: number[] = [];
        const skipped: { student_id: number; reason: string }[] = [];

        // 3. Process every student in student_ids
        for (const currentStudentId of student_ids) {
            // Check student existence
            const studentCheck = await pool.request()
                .input('student_id', sql.Int, currentStudentId)
                .query('SELECT student_id FROM students WHERE student_id = @student_id');

            if (studentCheck.recordset.length === 0) {
                skipped.push({ student_id: currentStudentId, reason: 'Student ID not found' });
                continue;
            }

            // Check if student is already in this batch
            const dupCheck = await pool.request()
                .input('batch_id', sql.Int, batch_id)
                .input('student_id', sql.Int, currentStudentId)
                .query('SELECT id FROM batch_students WHERE batch_id = @batch_id AND student_id = @student_id');

            if (dupCheck.recordset.length > 0) {
                skipped.push({ student_id: currentStudentId, reason: 'Already assigned to this batch' });
                continue;
            }

            // Insert valid assignment
            await pool.request()
                .input('batch_id', sql.Int, batch_id)
                .input('student_id', sql.Int, currentStudentId)
                .query('INSERT INTO batch_students (batch_id, student_id) VALUES (@batch_id, @student_id)');

            assigned.push(currentStudentId);
        }

        res.status(201).json({
            success: true,
            data: {
                batch_id,
                assigned_student_ids: assigned,
                skipped
            }
        });

    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Add Curriculum Day to Course
app.post('/api/courses/:id/days', async (req, res) => {
    const course_id = req.params.id;
    const { day_number, title, summary } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('course_id', sql.Int, course_id)
            .input('day_number', sql.Int, day_number)
            .input('title', sql.VarChar(150), title)
            .input('summary', sql.NVarChar(sql.MAX), summary)
            .query(`
                INSERT INTO course_days (course_id, day_number, title, summary)
                OUTPUT INSERTED.*
                VALUES (@course_id, @day_number, @title, @summary)
            `);
        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Add Content Item to Course Day
app.post('/api/course-days/:id/content', async (req, res) => {
    const course_day_id = req.params.id;
    const { title, rich_text_content, video_url, attachment_url } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('course_day_id', sql.Int, course_day_id)
            .input('title', sql.VarChar(200), title)
            .input('rich_text_content', sql.NVarChar(sql.MAX), rich_text_content)
            .input('video_url', sql.NVarChar(sql.MAX), video_url)
            .input('attachment_url', sql.NVarChar(sql.MAX), attachment_url)
            .query(`
                INSERT INTO course_contents (course_day_id, title, rich_text_content, video_url, attachment_url)
                OUTPUT INSERTED.*
                VALUES (@course_day_id, @title, @rich_text_content, @video_url, @attachment_url)
            `);
        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 1. AUTHENTICATION & OTP MODULE (§ 3)
// ==========================================

// Send OTP
app.post('/api/auth/send-otp', async (req, res) => {
    const { mobile_number } = req.body;
    if (!mobile_number) {
        return res.status(400).json({ success: false, message: 'Mobile number is required' });
    }

    try {
        const pool = await poolPromise;

        // Check if user exists with this mobile number
        const userCheck = await pool.request()
            .input('mobile', sql.VarChar(15), mobile_number)
            .query('SELECT id, name, role, is_active FROM users WHERE mobile_number = @mobile');

        if (userCheck.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No registered account found with this mobile number.'
            });
        }

        if (!userCheck.recordset[0].is_active) {
            return res.status(403).json({
                success: false,
                message: 'Account is deactivated. Please contact admin.'
            });
        }

        // Generate 6-digit numeric OTP code
        const otp_code = Math.floor(100000 + Math.random() * 900000).toString();

        await pool.request()
            .input('mobile_number', sql.VarChar(15), mobile_number)
            .input('otp_code', sql.VarChar(10), otp_code)
            .query(`
                INSERT INTO user_otps (mobile_number, otp_code, expires_at, is_used, created_at)
                VALUES (@mobile_number, @otp_code, DATE_ADD(NOW(), INTERVAL 5 MINUTE), 0, NOW())
            `);

        res.json({
            success: true,
            message: 'OTP generated and sent successfully (valid for 5 minutes).',
            otp_code // Returned for direct testing/Postman ease
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Verify OTP & Authenticate
app.post('/api/auth/verify-otp', async (req, res) => {
    const { mobile_number, otp_code } = req.body;
    if (!mobile_number || !otp_code) {
        return res.status(400).json({ success: false, message: 'mobile_number and otp_code are required' });
    }

    try {
        const pool = await poolPromise;

        // Find valid unused OTP
        const otpRecord = await pool.request()
            .input('mobile_number', sql.VarChar(15), mobile_number)
            .input('otp_code', sql.VarChar(10), otp_code)
            .query(`
                SELECT id, expires_at, is_used
                FROM user_otps
                WHERE mobile_number = @mobile_number 
                  AND otp_code = @otp_code 
                  AND is_used = 0 
                  AND expires_at >= NOW()
                ORDER BY id DESC
                LIMIT 1
            `);

        if (otpRecord.recordset.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired OTP.'
            });
        }

        // Mark OTP as used
        await pool.request()
            .input('id', sql.Int, otpRecord.recordset[0].id)
            .query('UPDATE user_otps SET is_used = 1 WHERE id = @id');

        // Fetch User and role details
        const userData = await pool.request()
            .input('mobile_number', sql.VarChar(15), mobile_number)
            .query(`
                SELECT u.id AS user_id, u.name, u.mobile_number, u.role, u.is_active,
                       s.student_id, s.certification_status,
                       t.trainer_id, t.specialization,
                       b.id AS batch_id, b.batch_code
                FROM users u
                LEFT JOIN students s ON s.user_id = u.id
                LEFT JOIN trainers t ON t.user_id = u.id
                LEFT JOIN batch_students bs ON bs.student_id = s.student_id
                LEFT JOIN batches b ON b.id = bs.batch_id
                WHERE u.mobile_number = @mobile_number
            `);

        res.json({
            success: true,
            message: 'Authentication successful',
            data: userData.recordset[0]
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 2. CURRICULUM & BATCH QUERIES (§ 6, 7, 8)
// ==========================================

// Get All Days for a Course
app.get('/api/courses/:id/days', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('course_id', sql.Int, req.params.id)
            .query(`
                SELECT id, course_id, day_number, title, summary
                FROM course_days
                WHERE course_id = @course_id
                ORDER BY day_number ASC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Published Content Items for a Course Day
app.get('/api/course-days/:id/content', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('course_day_id', sql.Int, req.params.id)
            .query(`
                SELECT id, course_day_id, title, rich_text_content, video_url, attachment_url, is_published, created_at
                FROM course_contents
                WHERE course_day_id = @course_day_id AND is_published = 1
                ORDER BY id ASC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get All Active Batches
app.get('/api/batches', async (req, res) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();
        let query = `
            SELECT b.id, b.batch_code, b.start_date, b.end_date, b.is_active, b.created_at,
                   c.id AS course_id, c.course_name,
                   t.trainer_id, u.name AS trainer_name
            FROM batches b
            INNER JOIN courses c ON b.course_id = c.id
            INNER JOIN trainers t ON b.trainer_id = t.trainer_id
            INNER JOIN users u ON t.user_id = u.id
            WHERE (@include_inactive = 1 OR b.is_active = 1)`;
        request.input('include_inactive', sql.Bit, req.query.include_inactive === '1');
        if (req.query.trainer_id) {
            request.input('trainer_id', sql.Int, req.query.trainer_id as string);
            query += ' AND t.trainer_id = @trainer_id';
        }
        query += ' ORDER BY b.id DESC';
        const result = await request.query(query);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Batch By ID (with Course & Trainer info)
app.get('/api/batches/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, req.params.id)
            .query(`
                SELECT b.id, b.batch_code, b.start_date, b.end_date, b.is_active, b.created_at,
                       c.id AS course_id, c.course_name, c.duration_days,
                       t.trainer_id, u.name AS trainer_name, u.mobile_number AS trainer_mobile
                FROM batches b
                INNER JOIN courses c ON b.course_id = c.id
                INNER JOIN trainers t ON b.trainer_id = t.trainer_id
                INNER JOIN users u ON t.user_id = u.id
                WHERE b.id = @batch_id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Batch not found' });
        }
        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Students in a Batch
app.get('/api/batches/:id/students', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, req.params.id)
            .query(`
                SELECT s.student_id, s.joining_date, s.certification_status,
                       u.id AS user_id, u.name, u.mobile_number, bs.assigned_at
                FROM batch_students bs
                INNER JOIN students s ON bs.student_id = s.student_id
                INNER JOIN users u ON s.user_id = u.id
                WHERE bs.batch_id = @batch_id
                ORDER BY u.name ASC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 3. LIVE CLASSES & RECORDINGS (§ 9, 11, 12)
// ==========================================

// Schedule Live Class (Teams Integration)
app.post('/api/live-classes', async (req, res) => {
    const { batch_id, course_day_id, class_topic, teams_meeting_link, start_time, end_time } = req.body;
    if (!batch_id || !class_topic || !teams_meeting_link || !start_time || !end_time) {
        return res.status(400).json({
            success: false,
            message: 'batch_id, class_topic, teams_meeting_link, start_time, and end_time are required'
        });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, batch_id)
            .input('course_day_id', sql.Int, course_day_id || null)
            .input('class_topic', sql.VarChar(200), class_topic)
            .input('teams_meeting_link', sql.NVarChar(sql.MAX), teams_meeting_link)
            .input('start_time', sql.DateTime2, start_time)
            .input('end_time', sql.DateTime2, end_time)
            .input('status', sql.VarChar(50), 'SCHEDULED')
            .query(`
                INSERT INTO live_classes (batch_id, course_day_id, class_topic, teams_meeting_link, start_time, end_time, status)
                OUTPUT INSERTED.*
                VALUES (@batch_id, @course_day_id, @class_topic, @teams_meeting_link, @start_time, @end_time, @status)
            `);
        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Live Classes for Batch
app.get('/api/batches/:id/live-classes', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, req.params.id)
            .query(`
                SELECT lc.*, cd.day_number, cd.title AS day_title
                FROM live_classes lc
                LEFT JOIN course_days cd ON lc.course_day_id = cd.id
                WHERE lc.batch_id = @batch_id
                ORDER BY lc.start_time DESC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Update Live Class Status
app.put('/api/live-classes/:id/status', async (req, res) => {
    const { status } = req.body;
    if (!status) {
        return res.status(400).json({ success: false, message: 'status is required' });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('status', sql.VarChar(50), status)
            .query(`
                UPDATE live_classes
                SET status = @status
                OUTPUT INSERTED.*
                WHERE id = @id
            `);
        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Live class not found' });
        }
        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Add Live Class Recording (Enforces 60-Day Retention)
app.post('/api/live-classes/:id/recordings', async (req, res) => {
    const live_class_id = req.params.id;
    const { storage_blob_path, duration_minutes } = req.body;

    if (!storage_blob_path) {
        return res.status(400).json({ success: false, message: 'storage_blob_path is required' });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('live_class_id', sql.Int, live_class_id)
            .input('storage_blob_path', sql.NVarChar(sql.MAX), storage_blob_path)
            .input('duration_minutes', sql.Int, duration_minutes || null)
            .query(`
                INSERT INTO class_recordings (live_class_id, storage_blob_path, duration_minutes, expiry_date, is_available)
                OUTPUT INSERTED.*
                VALUES (@live_class_id, @storage_blob_path, @duration_minutes, DATE_ADD(NOW(), INTERVAL 60 DAY), 1)
            `);
        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Active Recordings for Batch (Only non-expired)
app.get('/api/batches/:id/recordings', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, req.params.id)
            .query(`
                SELECT cr.*, lc.class_topic, lc.start_time AS class_start_time, cd.day_number
                FROM class_recordings cr
                INNER JOIN live_classes lc ON cr.live_class_id = lc.id
                LEFT JOIN course_days cd ON lc.course_day_id = cd.id
                WHERE lc.batch_id = @batch_id 
                  AND cr.is_available = 1 
                  AND cr.expiry_date >= NOW()
                ORDER BY cr.created_at DESC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 4. HYBRID ATTENDANCE MODULE (§ 10 & 15)
// ==========================================

// Mark / Upsert Attendance for a Batch
app.post('/api/attendance', async (req, res) => {
    const { batch_id, marked_by_trainer_id, class_date, records } = req.body;
    // records: [ { student_id: number, status: 'Present - Online' | 'Present - Offline' | 'Absent' | 'Leave' } ]

    if (!batch_id || !class_date || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'batch_id, class_date, and non-empty records array are required'
        });
    }

    try {
        const pool = await poolPromise;
        const saved: any[] = [];

        for (const item of records) {
            // Normalize status to uppercase with underscore (e.g., 'Present - Online' -> 'PRESENT_ONLINE')
            const normalizedStatus = item.status.trim().toUpperCase().replace(/\s*-\s*/g, '_').replace(/\s+/g, '_');

            await pool.request()
                .input('batch_id', sql.Int, batch_id)
                .input('student_id', sql.Int, item.student_id)
                .input('class_date', sql.Date, class_date)
                .input('status', sql.VarChar(50), normalizedStatus)
                .input('marked_by_trainer_id', sql.Int, marked_by_trainer_id || null)
                .query(`
                    INSERT INTO attendance (batch_id, student_id, class_date, status, marked_by_trainer_id)
                    VALUES (@batch_id, @student_id, @class_date, @status, @marked_by_trainer_id)
                    ON DUPLICATE KEY UPDATE
                        status = VALUES(status),
                        marked_by_trainer_id = VALUES(marked_by_trainer_id)
                `);

            const savedRecord = await pool.request()
                .input('batch_id', sql.Int, batch_id)
                .input('student_id', sql.Int, item.student_id)
                .input('class_date', sql.Date, class_date)
                .query(`
                    SELECT *
                    FROM attendance
                    WHERE batch_id = @batch_id
                      AND student_id = @student_id
                      AND class_date = @class_date
                `);
            saved.push(savedRecord.recordset[0]);
        }

        res.status(201).json({ success: true, count: saved.length, data: saved });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// View Batch Attendance Sheet
app.get('/api/batches/:id/attendance', async (req, res) => {
    const batch_id = req.params.id;
    const { date } = req.query;

    try {
        const pool = await poolPromise;
        const request = pool.request().input('batch_id', sql.Int, batch_id);

        let query = `
            SELECT a.*, u.name AS student_name, u.mobile_number
            FROM attendance a
            INNER JOIN students s ON a.student_id = s.student_id
            INNER JOIN users u ON s.user_id = u.id
            WHERE a.batch_id = @batch_id
        `;

        if (date) {
            request.input('class_date', sql.Date, date as string);
            query += ' AND a.class_date = @class_date';
        }

        query += ' ORDER BY a.class_date DESC, u.name ASC';

        const result = await request.query(query);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Student View Own Attendance & Percentage
app.get('/api/students/:id/attendance', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('student_id', sql.Int, req.params.id)
            .query(`
                SELECT a.*, b.batch_code
                FROM attendance a
                INNER JOIN batches b ON a.batch_id = b.id
                WHERE a.student_id = @student_id
                ORDER BY a.class_date DESC
            `);

        const records = result.recordset;
        const total = records.length;
        const present = records.filter(r => {
            const status = String(r.status).trim().toUpperCase().replace(/[\s-]+/g, '_');
            return status === 'PRESENT_ONLINE' || status === 'PRESENT_OFFLINE';
        }).length;
        const percentage = total > 0 ? Number(((present / total) * 100).toFixed(2)) : 0;

        res.json({
            success: true,
            total_classes: total,
            present_classes: present,
            attendance_percentage: percentage,
            data: records
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 5. ASSIGNMENT MODULE (§ 13)
// ==========================================

// Create Assignment
app.post('/api/assignments', async (req, res) => {
    const { batch_id, course_day_id, title, description, file_attachment_url, due_date } = req.body;
    if (!batch_id || !title || !due_date) {
        return res.status(400).json({
            success: false,
            message: 'batch_id, title, and due_date are required'
        });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, batch_id)
            .input('course_day_id', sql.Int, course_day_id || null)
            .input('title', sql.VarChar(200), title)
            .input('description', sql.NVarChar(sql.MAX), description || null)
            .input('file_attachment_url', sql.NVarChar(sql.MAX), file_attachment_url || null)
            .input('due_date', sql.DateTime2, due_date)
            .query(`
                INSERT INTO assignments (batch_id, course_day_id, title, description, file_attachment_url, due_date)
                OUTPUT INSERTED.*
                VALUES (@batch_id, @course_day_id, @title, @description, @file_attachment_url, @due_date)
            `);
        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Assignments for Batch
app.get('/api/batches/:id/assignments', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, req.params.id)
            .query(`
                SELECT a.*, cd.day_number, cd.title AS day_title
                FROM assignments a
                LEFT JOIN course_days cd ON a.course_day_id = cd.id
                WHERE a.batch_id = @batch_id
                ORDER BY a.due_date ASC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Student Submit Assignment
app.post('/api/assignments/:id/submit', async (req, res) => {
    const assignment_id = req.params.id;
    const { student_id, submission_file_url } = req.body;

    if (!student_id || !submission_file_url) {
        return res.status(400).json({
            success: false,
            message: 'student_id and submission_file_url are required'
        });
    }

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('assignment_id', sql.Int, assignment_id)
            .input('student_id', sql.Int, student_id)
            .input('submission_file_url', sql.NVarChar(sql.MAX), submission_file_url)
            .query(`
                INSERT INTO assignment_submissions (assignment_id, student_id, submission_file_url)
                VALUES (@assignment_id, @student_id, @submission_file_url)
                ON DUPLICATE KEY UPDATE
                    submission_file_url = VALUES(submission_file_url),
                    submitted_at = NOW(),
                    marks_obtained = NULL,
                    trainer_feedback = NULL
            `);
        const saved = await pool.request()
            .input('assignment_id', sql.Int, assignment_id)
            .input('student_id', sql.Int, student_id)
            .query(`
                SELECT * FROM assignment_submissions
                WHERE assignment_id = @assignment_id AND student_id = @student_id
            `);
        res.status(201).json({ success: true, data: saved.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Trainer View Submissions for an Assignment
app.get('/api/assignments/:id/submissions', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('assignment_id', sql.Int, req.params.id)
            .query(`
                SELECT sub.*, u.name AS student_name, u.mobile_number
                FROM assignment_submissions sub
                INNER JOIN students s ON sub.student_id = s.student_id
                INNER JOIN users u ON s.user_id = u.id
                WHERE sub.assignment_id = @assignment_id
                ORDER BY sub.submitted_at DESC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Trainer Grade Assignment Submission
app.put('/api/assignment-submissions/:id/grade', async (req, res) => {
    const { marks_obtained, trainer_feedback } = req.body;

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('marks_obtained', sql.Decimal(5, 2), marks_obtained)
            .input('trainer_feedback', sql.NVarChar(sql.MAX), trainer_feedback || null)
            .query(`
                UPDATE assignment_submissions
                SET marks_obtained = @marks_obtained, trainer_feedback = @trainer_feedback
                OUTPUT INSERTED.*
                WHERE id = @id
            `);
        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Submission not found' });
        }
        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 6. TEST / ASSESSMENT MODULE (§ 14)
// ==========================================

// Create Test / Upload Test Paper
app.post('/api/tests', async (req, res) => {
    const { batch_id, subject, title, test_paper_url, start_time, end_time, total_marks } = req.body;
    if (!batch_id || !subject || !title || !start_time || !end_time || total_marks === undefined) {
        return res.status(400).json({
            success: false,
            message: 'batch_id, subject, title, start_time, end_time, and total_marks are required'
        });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, batch_id)
            .input('subject', sql.VarChar(100), subject)
            .input('title', sql.VarChar(200), title)
            .input('test_paper_url', sql.NVarChar(sql.MAX), test_paper_url || null)
            .input('start_time', sql.DateTime2, start_time)
            .input('end_time', sql.DateTime2, end_time)
            .input('total_marks', sql.Int, total_marks)
            .query(`
                INSERT INTO tests (batch_id, subject, title, test_paper_url, start_time, end_time, total_marks)
                OUTPUT INSERTED.*
                VALUES (@batch_id, @subject, @title, @test_paper_url, @start_time, @end_time, @total_marks)
            `);
        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Tests for Batch
app.get('/api/batches/:id/tests', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, req.params.id)
            .query('SELECT * FROM tests WHERE batch_id = @batch_id ORDER BY start_time DESC');
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Student Submit Test
app.post('/api/tests/:id/submit', async (req, res) => {
    const test_id = req.params.id;
    const { student_id, answer_sheet_url } = req.body;

    if (!student_id || !answer_sheet_url) {
        return res.status(400).json({
            success: false,
            message: 'student_id and answer_sheet_url are required'
        });
    }

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('test_id', sql.Int, test_id)
            .input('student_id', sql.Int, student_id)
            .input('answer_sheet_url', sql.NVarChar(sql.MAX), answer_sheet_url)
            .query(`
                INSERT INTO test_submissions (test_id, student_id, answer_sheet_url)
                VALUES (@test_id, @student_id, @answer_sheet_url)
                ON DUPLICATE KEY UPDATE
                    answer_sheet_url = VALUES(answer_sheet_url),
                    submitted_at = NOW(),
                    marks_obtained = NULL
            `);
        const saved = await pool.request()
            .input('test_id', sql.Int, test_id)
            .input('student_id', sql.Int, student_id)
            .query(`
                SELECT * FROM test_submissions
                WHERE test_id = @test_id AND student_id = @student_id
            `);
        res.status(201).json({ success: true, data: saved.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Trainer View Submissions for a Test
app.get('/api/tests/:id/submissions', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('test_id', sql.Int, req.params.id)
            .query(`
                SELECT ts.*, u.name AS student_name, u.mobile_number
                FROM test_submissions ts
                INNER JOIN students s ON ts.student_id = s.student_id
                INNER JOIN users u ON s.user_id = u.id
                WHERE ts.test_id = @test_id
                ORDER BY ts.submitted_at DESC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Grade Test Submission
app.put('/api/test-submissions/:id/grade', async (req, res) => {
    const { marks_obtained } = req.body;

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('marks_obtained', sql.Decimal(5, 2), marks_obtained)
            .query(`
                UPDATE test_submissions
                SET marks_obtained = @marks_obtained
                OUTPUT INSERTED.*
                WHERE id = @id
            `);
        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Test submission not found' });
        }
        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Student View: My assignment + test submissions (with marks & feedback)
app.get('/api/students/:id/submissions', async (req, res) => {
    try {
        const pool = await poolPromise;
        const assignmentSubmissions = await pool.request()
            .input('student_id', sql.Int, req.params.id)
            .query(`
                SELECT sub.*, a.title AS assignment_title, a.due_date, a.batch_id
                FROM assignment_submissions sub
                INNER JOIN assignments a ON sub.assignment_id = a.id
                WHERE sub.student_id = @student_id
                ORDER BY sub.submitted_at DESC
            `);
        const testSubmissions = await pool.request()
            .input('student_id', sql.Int, req.params.id)
            .query(`
                SELECT ts.*, t.title AS test_title, t.subject, t.total_marks, t.batch_id
                FROM test_submissions ts
                INNER JOIN tests t ON ts.test_id = t.id
                WHERE ts.student_id = @student_id
                ORDER BY ts.submitted_at DESC
            `);
        res.json({
            success: true,
            data: {
                assignments: assignmentSubmissions.recordset,
                tests: testSubmissions.recordset,
            },
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 7. MESSAGE BOARD / ANNOUNCEMENTS (§ 17)
// ==========================================

// Create Announcement
app.post('/api/announcements', async (req, res) => {
    const { batch_id, created_by_user_id, title, content, is_pinned } = req.body;
    if (!batch_id || !created_by_user_id || !title || !content) {
        return res.status(400).json({
            success: false,
            message: 'batch_id, created_by_user_id, title, and content are required'
        });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, batch_id)
            .input('created_by_user_id', sql.Int, created_by_user_id)
            .input('title', sql.VarChar(200), title)
            .input('content', sql.NVarChar(sql.MAX), content)
            .input('is_pinned', sql.Bit, is_pinned ? 1 : 0)
            .query(`
                INSERT INTO announcements (batch_id, created_by_user_id, title, content, is_pinned)
                OUTPUT INSERTED.*
                VALUES (@batch_id, @created_by_user_id, @title, @content, @is_pinned)
            `);
        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Batch Announcements
app.get('/api/batches/:id/announcements', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, req.params.id)
            .query(`
                SELECT a.*, u.name AS author_name, u.role AS author_role
                FROM announcements a
                INNER JOIN users u ON a.created_by_user_id = u.id
                WHERE a.batch_id = @batch_id
                ORDER BY a.is_pinned DESC, a.created_at DESC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 8. REALTIME BATCH CHAT WITH TIMER (§ 16)
// ==========================================

// Configure / Open / Close Batch Chat Room
app.post('/api/batches/:id/chat-room', async (req, res) => {
    const batch_id = req.params.id;
    const { is_active, active_from, active_until } = req.body;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('batch_id', sql.Int, batch_id)
            .input('is_active', sql.Bit, is_active !== undefined ? (is_active ? 1 : 0) : 1)
            .input('active_from', sql.DateTime2, active_from || null)
            .input('active_until', sql.DateTime2, active_until || null)
            .query(`
                INSERT INTO chat_rooms (batch_id, is_active, active_from, active_until)
                VALUES (@batch_id, @is_active, @active_from, @active_until)
                ON DUPLICATE KEY UPDATE
                    is_active = VALUES(is_active),
                    active_from = VALUES(active_from),
                    active_until = VALUES(active_until)
            `);

        const result = await pool.request()
            .input('batch_id', sql.Int, batch_id)
            .query('SELECT * FROM chat_rooms WHERE batch_id = @batch_id');
        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Chat Room Status (Checks Active Timer)
app.get('/api/batches/:id/chat-room', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('batch_id', sql.Int, req.params.id)
            .query(`
                SELECT cr.*,
                       CASE 
                           WHEN cr.is_active = 1 
                                AND (cr.active_from IS NULL OR cr.active_from <= NOW())
                                AND (cr.active_until IS NULL OR cr.active_until >= NOW())
                           THEN 1 ELSE 0 
                       END AS is_currently_open
                FROM chat_rooms cr
                WHERE cr.batch_id = @batch_id
            `);

        if (result.recordset.length === 0) {
            return res.json({ success: true, data: null, message: 'Chat room not yet initialized for this batch' });
        }
        res.json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Send Chat Message
app.post('/api/chat-rooms/:id/messages', async (req, res) => {
    const chat_room_id = req.params.id;
    const { sender_user_id, message } = req.body;

    if (!sender_user_id || !message) {
        return res.status(400).json({ success: false, message: 'sender_user_id and message are required' });
    }

    try {
        const pool = await poolPromise;

        // Verify chat room is currently active according to timer
        const roomStatus = await pool.request()
            .input('id', sql.Int, chat_room_id)
            .query(`
                SELECT cr.*,
                       CASE 
                           WHEN cr.is_active = 1 
                                AND (cr.active_from IS NULL OR cr.active_from <= NOW())
                                AND (cr.active_until IS NULL OR cr.active_until >= NOW())
                           THEN 1 ELSE 0 
                       END AS is_currently_open
                FROM chat_rooms cr
                WHERE cr.id = @id
            `);

        if (roomStatus.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Chat room not found' });
        }

        if (roomStatus.recordset[0].is_currently_open !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Chat is currently closed by the trainer or class timer has expired.'
            });
        }

        const result = await pool.request()
            .input('chat_room_id', sql.Int, chat_room_id)
            .input('sender_user_id', sql.Int, sender_user_id)
            .input('message', sql.NVarChar(sql.MAX), message)
            .query(`
                INSERT INTO chat_messages (chat_room_id, sender_user_id, message)
                OUTPUT INSERTED.*
                VALUES (@chat_room_id, @sender_user_id, @message)
            `);
        res.status(201).json({ success: true, data: result.recordset[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Chat Message History
app.get('/api/chat-rooms/:id/messages', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('chat_room_id', sql.Int, req.params.id)
            .query(`
                SELECT cm.*, u.name AS sender_name, u.role AS sender_role
                FROM chat_messages cm
                INNER JOIN users u ON cm.sender_user_id = u.id
                WHERE cm.chat_room_id = @chat_room_id
                ORDER BY cm.sent_at ASC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 9. CERTIFICATION MODULE (§ 19)
// ==========================================

// Issue Certificate
app.post('/api/certificates', async (req, res) => {
    const { student_id, batch_id, course_completed } = req.body;
    if (!student_id || !batch_id || course_completed !== true) {
        return res.status(400).json({
            success: false,
            message: 'student_id, batch_id, and confirmed course completion are required'
        });
    }

    try {
        const pool = await poolPromise;
        const enrollment = await pool.request()
            .input('student_id', sql.Int, student_id)
            .input('batch_id', sql.Int, batch_id)
            .query(`
                SELECT s.student_id, u.name AS student_name, c.course_name, b.batch_code
                FROM students s
                INNER JOIN users u ON s.user_id = u.id AND UPPER(u.role) = 'STUDENT'
                INNER JOIN batch_students bs ON bs.student_id = s.student_id
                INNER JOIN batches b ON b.id = bs.batch_id
                INNER JOIN courses c ON c.id = b.course_id
                WHERE s.student_id = @student_id AND b.id = @batch_id
            `);
        if (enrollment.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student is not assigned to this batch.'
            });
        }

        const attendanceResult = await pool.request()
            .input('student_id', sql.Int, student_id)
            .input('batch_id', sql.Int, batch_id)
            .query(`
                SELECT
                    COUNT(*) AS total_classes,
                    SUM(CASE
                        WHEN UPPER(REPLACE(REPLACE(LTRIM(RTRIM(status)), ' ', '_'), '-', '_'))
                             IN ('PRESENT_ONLINE', 'PRESENT_OFFLINE')
                        THEN 1 ELSE 0
                    END) AS present_classes
                FROM attendance
                WHERE student_id = @student_id AND batch_id = @batch_id
            `);
        const totalClasses = Number(attendanceResult.recordset[0].total_classes) || 0;
        const presentClasses = Number(attendanceResult.recordset[0].present_classes) || 0;
        const attendancePercentage = totalClasses > 0 ? (presentClasses / totalClasses) * 100 : 0;
        if (attendancePercentage < 75) {
            return res.status(400).json({
                success: false,
                message: `Certificate requires at least 75% attendance. Current attendance: ${attendancePercentage.toFixed(2)}%.`,
                attendance_percentage: Number(attendancePercentage.toFixed(2))
            });
        }

        const existingCertificate = await pool.request()
            .input('student_id', sql.Int, student_id)
            .input('batch_id', sql.Int, batch_id)
            .query(`
                SELECT id, certificate_number
                FROM certificates
                WHERE student_id = @student_id AND batch_id = @batch_id
                ORDER BY issued_at DESC
                LIMIT 1
            `);
        let certificateId: number;
        let certificateNumber: string;
        let created = false;

        if (existingCertificate.recordset.length > 0) {
            certificateId = existingCertificate.recordset[0].id;
            certificateNumber = existingCertificate.recordset[0].certificate_number;
        } else {
            certificateNumber = `CERT-${new Date().getFullYear()}-S${student_id}-B${batch_id}`;
            const result = await pool.request()
                .input('certificate_number', sql.VarChar(100), certificateNumber)
                .input('student_id', sql.Int, student_id)
                .input('batch_id', sql.Int, batch_id)
                .query(`
                    INSERT INTO certificates (certificate_number, student_id, batch_id, pdf_url)
                    OUTPUT INSERTED.id
                    VALUES (@certificate_number, @student_id, @batch_id, NULL)
                `);
            certificateId = result.recordset[0].id;
            created = true;
        }

        const pdfUrl = `/api/certificates/${certificateId}/download`;
        try {
            const pdf = await createCertificatePdf({
                certificateNumber,
                studentName: enrollment.recordset[0].student_name,
                courseName: enrollment.recordset[0].course_name,
                batchCode: enrollment.recordset[0].batch_code,
                issuedAt: new Date(),
            });
            await mkdir(certificateDirectory, { recursive: true });
            await writeFile(path.join(certificateDirectory, `certificate-${certificateId}.pdf`), pdf);
            await pool.request()
                .input('certificate_id', sql.Int, certificateId)
                .input('pdf_url', sql.NVarChar(500), pdfUrl)
                .query('UPDATE certificates SET pdf_url = @pdf_url WHERE id = @certificate_id');
            await pool.request()
                .input('student_id', sql.Int, student_id)
                .query("UPDATE students SET certification_status = 'CERTIFIED' WHERE student_id = @student_id");
        } catch (generationError) {
            if (created) {
                await pool.request()
                    .input('certificate_id', sql.Int, certificateId)
                    .query('DELETE FROM certificates WHERE id = @certificate_id');
            }
            throw generationError;
        }

        res.status(created ? 201 : 200).json({
            success: true,
            data: {
                id: certificateId,
                certificate_number: certificateNumber,
                student_id,
                batch_id,
                pdf_url: pdfUrl,
                attendance_percentage: Number(attendancePercentage.toFixed(2))
            }
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Edit Certificate (details + regenerate the PDF)
app.put('/api/certificates/:id', async (req, res) => {
    const certificateId = Number(req.params.id);
    if (!Number.isInteger(certificateId) || certificateId <= 0) {
        res.status(400).json({ success: false, message: 'Invalid certificate ID' });
        return;
    }

    const { certificate_number, recipient_name, course_title, batch_label, issued_at } = req.body || {};

    try {
        const pool = await poolPromise;
        const existing = await loadCertificateById(pool, certificateId);
        if (!existing) {
            res.status(404).json({ success: false, message: 'Certificate not found' });
            return;
        }

        const update = pool.request().input('certificate_id', sql.Int, certificateId);
        const fields: string[] = [];

        if (certificate_number !== undefined) {
            const value = String(certificate_number).trim();
            if (!value) {
                res.status(400).json({ success: false, message: 'Certificate number cannot be empty' });
                return;
            }
            fields.push('certificate_number = @certificate_number');
            update.input('certificate_number', sql.VarChar(100), value);
        }
        if (recipient_name !== undefined) {
            fields.push('recipient_name = @recipient_name');
            update.input('recipient_name', sql.VarChar(150), String(recipient_name || '').trim() || null);
        }
        if (course_title !== undefined) {
            fields.push('course_title = @course_title');
            update.input('course_title', sql.VarChar(200), String(course_title || '').trim() || null);
        }
        if (batch_label !== undefined) {
            fields.push('batch_label = @batch_label');
            update.input('batch_label', sql.VarChar(80), String(batch_label || '').trim() || null);
        }
        if (issued_at !== undefined) {
            const raw = String(issued_at).trim();
            let parsed = new Date(raw);
            if (Number.isNaN(parsed.getTime())) {
                res.status(400).json({ success: false, message: 'Invalid issue date' });
                return;
            }
            // A date-only edit (from the form) keeps the original time of day.
            if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
                const current = existing.issued_at instanceof Date ? existing.issued_at : new Date(existing.issued_at);
                const [year, month, day] = raw.split('-').map(Number);
                const sameDay = current.getFullYear() === year
                    && current.getMonth() + 1 === month
                    && current.getDate() === day;
                parsed = sameDay
                    ? new Date(year, month - 1, day, current.getHours(), current.getMinutes(), current.getSeconds())
                    : new Date(year, month - 1, day, 9, 0, 0);
            }
            fields.push('issued_at = @issued_at');
            update.input('issued_at', sql.DateTime2, parsed);
        }

        if (fields.length === 0) {
            res.status(400).json({ success: false, message: 'Nothing to update' });
            return;
        }

        await update.query(`UPDATE certificates SET ${fields.join(', ')} WHERE id = @certificate_id`);

        const updated = await loadCertificateById(pool, certificateId);
        if (!updated) {
            res.status(404).json({ success: false, message: 'Certificate not found' });
            return;
        }

        // Regenerate the PDF so the file matches the edited details.
        const pdfUrl = await writeCertificatePdf(updated);
        await pool.request()
            .input('certificate_id', sql.Int, certificateId)
            .input('pdf_url', sql.NVarChar(500), pdfUrl)
            .query('UPDATE certificates SET pdf_url = @pdf_url WHERE id = @certificate_id');
        updated.pdf_url = pdfUrl;

        res.json({ success: true, data: certificateResponse(updated) });
    } catch (err: any) {
        if (String(err?.code || '').includes('ER_DUP_ENTRY')) {
            res.status(400).json({ success: false, message: 'That certificate number is already used by another certificate' });
            return;
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Student Certificates
app.get('/api/students/:id/certificates', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('student_id', sql.Int, req.params.id)
            .query(`
                SELECT cert.*, b.batch_code, c.course_name, u.name AS student_name
                FROM certificates cert
                INNER JOIN batches b ON cert.batch_id = b.id
                INNER JOIN courses c ON b.course_id = c.id
                INNER JOIN students s ON cert.student_id = s.student_id
                INNER JOIN users u ON s.user_id = u.id
                WHERE cert.student_id = @student_id
                ORDER BY cert.issued_at DESC
            `);
        res.json({ success: true, data: result.recordset.map((row: any) => certificateResponse(row as CertificateRow)) });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`TypeScript Server running on port ${PORT}`));