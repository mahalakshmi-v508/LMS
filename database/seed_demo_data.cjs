#!/usr/bin/env node
/**
 * LMS demo-data seeder (idempotent).
 *
 * Fills every module with sample rows so each portal screen has something to show:
 *   Admin   -> students, trainers, courses, batches, curriculum
 *   Trainer -> batches, live classes, recordings, attendance, assignments, tests, announcements, chat
 *   Student -> classroom, classes, recordings, attendance, assignments, tests, chat, announcements, certificates
 *   EMS     -> departments, designations, employees, attendance, leaves, trainings
 *
 * Run from the project root:
 *     node database/seed_demo_data.cjs
 *
 * Safe to run many times: rows are matched on natural/unique keys and only missing ones are inserted.
 */
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('../backend/node_modules/mysql2/promise');

// ---------------------------------------------------------------------------
// Config (reads backend/.env so we don't hardcode credentials)
// ---------------------------------------------------------------------------
function loadEnv() {
    const envPath = path.join(__dirname, '..', 'backend', '.env');
    const env = {};
    if (fs.existsSync(envPath)) {
        for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    }
    return env;
}

const env = loadEnv();
const DB = {
    host: env.DB_HOST || process.env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || process.env.DB_PORT || 3306),
    user: env.DB_USER || process.env.DB_USER || 'root',
    password: env.DB_PASSWORD ?? process.env.DB_PASSWORD ?? '',
    database: env.DB_NAME || process.env.DB_NAME || 'LMS',
    dateStrings: true,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
let conn;
const stats = {};

const pad = (n) => String(n).padStart(2, '0');
const dt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dateOnly = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };

async function rows(sql, params = []) {
    const [r] = await conn.query(sql, params);
    return r;
}
async function row(sql, params = []) {
    return (await rows(sql, params))[0];
}
async function exec(sql, params = []) {
    const [r] = await conn.query(sql, params);
    return r;
}
function bump(table, n = 1) {
    stats[table] = (stats[table] || 0) + n;
}

async function ensureUser(name, mobile, role) {
    let r = await row('SELECT id FROM users WHERE mobile_number = ?', [mobile]);
    if (r) return r.id;
    const ins = await exec(
        'INSERT INTO users (name, mobile_number, role, is_active) VALUES (?, ?, ?, 1)',
        [name, mobile, role],
    );
    bump('users');
    return ins.insertId;
}

async function ensureChatRoom(batchId) {
    await exec(
        `INSERT INTO chat_rooms (batch_id, is_active, active_from, active_until)
         VALUES (?, 1, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))
         ON DUPLICATE KEY UPDATE
             is_active = 1,
             active_from = NOW(),
             active_until = DATE_ADD(NOW(), INTERVAL 7 DAY)`,
        [batchId],
    );
    return (await row('SELECT id FROM chat_rooms WHERE batch_id = ?', [batchId])).id;
}

async function ensureChatMessage(roomId, userId, message, minutesAgo) {
    const exists = await row(
        'SELECT id FROM chat_messages WHERE chat_room_id = ? AND sender_user_id = ? AND message = ?',
        [roomId, userId, message],
    );
    if (exists) return exists.id;
    const sentAt = dt(new Date(Date.now() - minutesAgo * 60_000));
    const ins = await exec(
        'INSERT INTO chat_messages (chat_room_id, sender_user_id, message, sent_at) VALUES (?, ?, ?, ?)',
        [roomId, userId, message, sentAt],
    );
    bump('chat_messages');
    return ins.insertId;
}

async function ensureLiveClass({ batchId, dayId, topic, link, start, end, status }) {
    let r = await row('SELECT id FROM live_classes WHERE batch_id = ? AND class_topic = ?', [batchId, topic]);
    if (r) return r.id;
    const ins = await exec(
        `INSERT INTO live_classes (batch_id, course_day_id, class_topic, teams_meeting_link, start_time, end_time, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [batchId, dayId, topic, link, dt(start), dt(end), status],
    );
    bump('live_classes');
    return ins.insertId;
}

async function ensureRecording(liveClassId, blobPath, duration, expiry) {
    const exists = await row(
        'SELECT id FROM class_recordings WHERE live_class_id = ? AND storage_blob_path = ?',
        [liveClassId, blobPath],
    );
    if (exists) return exists.id;
    const ins = await exec(
        `INSERT INTO class_recordings (live_class_id, storage_blob_path, duration_minutes, expiry_date, is_available)
         VALUES (?, ?, ?, ?, 1)`,
        [liveClassId, blobPath, duration, dt(expiry)],
    );
    bump('class_recordings');
    return ins.insertId;
}

async function ensureAssignment({ batchId, dayId, title, description, attachment, due }) {
    let r = await row('SELECT id FROM assignments WHERE batch_id = ? AND title = ?', [batchId, title]);
    if (r) return r.id;
    const ins = await exec(
        `INSERT INTO assignments (batch_id, course_day_id, title, description, file_attachment_url, due_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [batchId, dayId, title, description, attachment, dt(due)],
    );
    bump('assignments');
    return ins.insertId;
}

async function ensureTest({ batchId, subject, title, paperUrl, start, end, totalMarks }) {
    let r = await row('SELECT id FROM tests WHERE batch_id = ? AND title = ?', [batchId, title]);
    if (r) return r.id;
    const ins = await exec(
        `INSERT INTO tests (batch_id, subject, title, test_paper_url, start_time, end_time, total_marks)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [batchId, subject, title, paperUrl, dt(start), dt(end), totalMarks],
    );
    bump('tests');
    return ins.insertId;
}

async function ensureAnnouncement({ batchId, userId, title, content, pinned }) {
    let r = await row('SELECT id FROM announcements WHERE batch_id = ? AND title = ?', [batchId, title]);
    if (r) return r.id;
    const ins = await exec(
        `INSERT INTO announcements (batch_id, created_by_user_id, title, content, is_pinned)
         VALUES (?, ?, ?, ?, ?)`,
        [batchId, userId, title, content, pinned ? 1 : 0],
    );
    bump('announcements');
    return ins.insertId;
}

async function ensureEmployee({ name, mobile, deptId, designationId, code, managerId, salary, joining, email, emergency, address, employmentType = 'FULL_TIME', status = 'ACTIVE' }) {
    const userId = await ensureUser(name, mobile, 'EMPLOYEE');

    // Mirror the app: every employee gets an LMS student profile.
    await exec(
        'INSERT IGNORE INTO students (user_id, joining_date, certification_status) VALUES (?, ?, ?)',
        [userId, joining, 'PENDING'],
    );

    let emp = await row('SELECT id FROM ems_employees WHERE user_id = ?', [userId]);
    if (!emp) {
        const ins = await exec(
            `INSERT INTO ems_employees
                (user_id, employee_code, department_id, designation_id, reporting_manager_id,
                 employment_type, status, date_of_joining, work_email, emergency_contact, address, salary_monthly)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, code, deptId, designationId, managerId, employmentType, status, joining, email, emergency, address, salary],
        );
        bump('ems_employees');
        emp = { id: ins.insertId };
    }
    return { employeeId: emp.id, userId };
}

async function ensureEmsAttendance({ employeeId, day, checkIn, checkOut, status, mode, remarks }) {
    const exists = await row(
        'SELECT id FROM ems_attendance WHERE employee_id = ? AND attendance_date = ?',
        [employeeId, day],
    );
    if (exists) return exists.id;
    const ins = await exec(
        `INSERT INTO ems_attendance (employee_id, attendance_date, check_in_time, check_out_time, status, work_mode, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [employeeId, day, checkIn, checkOut, status, mode, remarks],
    );
    bump('ems_attendance');
    return ins.insertId;
}

async function ensureLeave({ employeeId, type, from, to, days, reason, status, approvedBy, remarks }) {
    const exists = await row(
        'SELECT id FROM ems_leaves WHERE employee_id = ? AND leave_type = ? AND from_date = ?',
        [employeeId, type, from],
    );
    if (exists) return exists.id;
    const ins = await exec(
        `INSERT INTO ems_leaves (employee_id, leave_type, from_date, to_date, total_days, reason, status, approved_by, action_remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [employeeId, type, from, to, days, reason, status, approvedBy, remarks],
    );
    bump('ems_leaves');
    return ins.insertId;
}

async function ensureTraining({ employeeId, courseId, batchId, type, deadline, status, progress, certIssued }) {
    const exists = await row(
        'SELECT id FROM ems_employee_trainings WHERE employee_id = ? AND course_id = ? AND batch_id <=> ?',
        [employeeId, courseId, batchId],
    );
    if (exists) return exists.id;
    const ins = await exec(
        `INSERT INTO ems_employee_trainings
            (employee_id, course_id, batch_id, training_type, enrollment_date, completion_deadline,
             status, progress_percentage, certification_issued)
         VALUES (?, ?, ?, ?, CURDATE(), ?, ?, ?, ?)`,
        [employeeId, courseId, batchId, type, deadline, status, progress, certIssued ? 1 : 0],
    );
    bump('ems_employee_trainings');
    return ins.insertId;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function seed() {
    conn = await mysql.createConnection(DB);
    console.log(`Connected to MySQL ${DB.database} @ ${DB.host}:${DB.port}\n`);

    const today = new Date();
    const courseId = 1;          // Full Stack Development
    const mainBatchId = 1;       // BATCH-2026-01 (all 3 students)
    const secondBatchId = 2;     // BATCH-2026-02
    const kumariBatchId = 3;     // B0002

    // -----------------------------------------------------------------------
    // 1. People
    // -----------------------------------------------------------------------
    const priyaUserId = await ensureUser('Priya Trainer', '9000000002', 'TRAINER');
    const arunUserId = await ensureUser('Arun Student', '9000000003', 'STUDENT');
    const mahaUserId = await ensureUser('maha', '7845466508', 'STUDENT');
    const mathaviUserId = await ensureUser('mathavi', '7305336488', 'STUDENT');
    const kumariUserId = await ensureUser('kumari', '7843567865', 'TRAINER');

    const studentIds = {};
    for (const [key, userId] of Object.entries({ arun: arunUserId, maha: mahaUserId, mathavi: mathaviUserId })) {
        let s = await row('SELECT student_id FROM students WHERE user_id = ?', [userId]);
        if (!s) {
            const ins = await exec(
                'INSERT INTO students (user_id, joining_date, certification_status) VALUES (?, ?, ?)',
                [userId, dateOnly(addDays(today, -5)), 'PENDING'],
            );
            bump('students');
            s = { student_id: ins.insertId };
        }
        studentIds[key] = s.student_id;
    }

    // -----------------------------------------------------------------------
    // 2. Curriculum for course 1 (days 1..12) + learning material
    // -----------------------------------------------------------------------
    const courseDays = [
        [1, 'Introduction to HTML5', 'Document structure, semantic tags, forms and accessibility basics.'],
        [2, 'HTML Layout & Media', 'Tables, images, audio/video embeds and responsive meta tags.'],
        [3, 'CSS Fundamentals', 'Selectors, specificity, the box model and typography.'],
        [4, 'Flexbox & Grid Layouts', 'Building responsive page layouts with modern CSS.'],
        [5, 'JavaScript Basics', 'Variables, functions, arrays, objects and control flow.'],
        [6, 'DOM & Event Handling', 'Selecting elements, events, forms and dynamic UI updates.'],
        [7, 'ES6+ & Async JavaScript', 'Arrow functions, promises, async/await and modules.'],
        [8, 'React Fundamentals', 'Components, props, state and component lifecycle.'],
        [9, 'React Hooks & Routing', 'useState, useEffect, context and client-side routing.'],
        [10, 'Node.js & Express APIs', 'REST endpoints, middleware, validation and error handling.'],
        [11, 'MySQL & Data Modelling', 'Tables, relationships, joins and query optimisation.'],
        [12, 'Auth, JWT & Security', 'OTP login, JWT sessions, role-based access and OWASP basics.'],
    ];
    for (const [dayNumber, title, summary] of courseDays) {
        const before = await row('SELECT id FROM course_days WHERE course_id = ? AND day_number = ?', [courseId, dayNumber]);
        await exec(
            `INSERT INTO course_days (course_id, day_number, title, summary) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE course_id = course_id`,
            [courseId, dayNumber, title, summary],
        );
        if (!before) bump('course_days');
    }

    const dayRows = await rows('SELECT id, day_number FROM course_days WHERE course_id = ?', [courseId]);
    const dayId = {};
    for (const d of dayRows) dayId[d.day_number] = d.id;

    const contents = [
        [1, 'HTML5 Crash Course', 'Read the HTML Living Standard essentials: document skeleton, semantic elements, forms and validation. Complete the practice file `day01.html`.', 'https://www.youtube.com/watch?v=UB1O30fR-EE', 'https://developer.mozilla.org/en-US/docs/Web/HTML'],
        [3, 'CSS Box Model & Selectors', 'Understand specificity, the cascade, padding/border/margin and units. Build the card component from the attached starter file.', 'https://www.youtube.com/watch?v=1Rs2ND1ryYc', 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_box_model'],
        [4, 'Flexbox & Grid Lab', 'Recreate the attached dashboard screenshot using Flexbox for the navbar and CSS Grid for the card sections.', 'https://www.youtube.com/watch?v=JJSoEo8JSnc', 'https://css-tricks.com/snippets/css/complete-guide-grid/'],
        [5, 'JavaScript Fundamentals', 'Practice variables, functions, arrays and objects in the browser console. Solve the 10 exercise prompts in the workbook.', 'https://www.youtube.com/watch?v=W6NZfCO5SIk', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide'],
        [6, 'DOM & Events Workshop', 'Wire up buttons and forms with addEventListener and build the interactive todo list demo.', 'https://www.youtube.com/watch?v=y17RuWkWdn8', 'https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model'],
        [7, 'Async JavaScript Deep Dive', 'Promises, fetch, async/await and error handling. Consume the sample JSON API given in the notes.', 'https://www.youtube.com/watch?v=PoRJizFvM7s', 'https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous'],
        [8, 'React Components', 'Create reusable components, pass props, manage local state and render lists with keys.', 'https://www.youtube.com/watch?v=w7ejDZ8SWv8', 'https://react.dev/learn'],
        [9, 'React Hooks & Router', 'Move state with useState, fetch data with useEffect and add routes with react-router.', 'https://www.youtube.com/watch?v=TNhaISOUy6Q', 'https://react.dev/reference/react/hooks'],
        [10, 'Express REST API', 'Build CRUD endpoints with Express, add middleware and test them with Postman/Thunder Client.', 'https://www.youtube.com/watch?v=Oe421EPjeBE', 'https://expressjs.com/en/starter/basic-routing.html'],
        [11, 'MySQL Data Modelling', 'Design the LMS schema: primary keys, foreign keys, indexes and joins. Run the practice queries.', 'https://www.youtube.com/watch?v=9ylj9NR0Lcg', 'https://dev.mysql.com/doc/refman/8.0/en/tutorial.html'],
        [12, 'Authentication & JWT', 'Implement OTP login, hash storage, JWT sessions and role-based guards.', 'https://www.youtube.com/watch?v=mbsmsi7l3r4', 'https://jwt.io/introduction'],
    ];
    for (const [dayNumber, title, rich, video, attachment] of contents) {
        const existing = await row('SELECT id FROM course_contents WHERE course_day_id = ? LIMIT 1', [dayId[dayNumber]]);
        if (existing) continue;
        await exec(
            `INSERT INTO course_contents (course_day_id, title, rich_text_content, video_url, attachment_url, is_published)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [dayId[dayNumber], title, rich, video, attachment],
        );
        bump('course_contents');
    }

    // -----------------------------------------------------------------------
    // 3. Live classes + recordings (batch 1)
    // -----------------------------------------------------------------------
    const live1 = await ensureLiveClass({
        batchId: mainBatchId, dayId: dayId[1], topic: 'HTML & CSS Foundations',
        link: 'https://teams.microsoft.com/l/meetup-join/demo-html-css',
        start: at(addDays(today, -2), 10), end: at(addDays(today, -2), 11, 30), status: 'COMPLETED',
    });
    const live2 = await ensureLiveClass({
        batchId: mainBatchId, dayId: dayId[6], topic: 'JavaScript DOM Workshop',
        link: 'https://teams.microsoft.com/l/meetup-join/demo-js-dom',
        start: at(addDays(today, -1), 10), end: at(addDays(today, -1), 11, 30), status: 'COMPLETED',
    });
    await ensureLiveClass({
        batchId: mainBatchId, dayId: dayId[8], topic: 'React Fundamentals Live',
        link: 'https://teams.microsoft.com/l/meetup-join/demo-react',
        start: at(addDays(today, 1), 10), end: at(addDays(today, 1), 11, 30), status: 'SCHEDULED',
    });
    await ensureLiveClass({
        batchId: mainBatchId, dayId: dayId[10], topic: 'Node.js REST API Lab',
        link: 'https://teams.microsoft.com/l/meetup-join/demo-node',
        start: at(addDays(today, 3), 10), end: at(addDays(today, 3), 11, 30), status: 'SCHEDULED',
    });

    await ensureRecording(live1, 'https://storage.example.com/recordings/batch1-html-css.mp4', 90, addDays(today, 58));
    await ensureRecording(live2, 'https://storage.example.com/recordings/batch1-js-dom.mp4', 90, addDays(today, 59));

    // A light set for batch 2 so trainer batch switching is not empty.
    await ensureLiveClass({
        batchId: secondBatchId, dayId: dayId[3], topic: 'CSS Layout Revision',
        link: 'https://teams.microsoft.com/l/meetup-join/demo-b2-css',
        start: at(addDays(today, 2), 15), end: at(addDays(today, 2), 16, 30), status: 'SCHEDULED',
    });
    await ensureAssignment({
        batchId: secondBatchId, dayId: dayId[3], title: 'CSS Card Component',
        description: 'Build the pricing card component shown in class.', attachment: null, due: addDays(today, 6),
    });

    // -----------------------------------------------------------------------
    // 4. Attendance (batch 1, last 10 weekdays, 3 students)
    // -----------------------------------------------------------------------
    const classDates = [];
    let cursor = new Date(today);
    while (classDates.length < 10) {
        const dow = cursor.getDay();
        if (dow !== 0 && dow !== 6) classDates.push(dateOnly(cursor));
        cursor = addDays(cursor, -1);
    }

    const attendancePlan = {
        arun: ['PRESENT_ONLINE', 'PRESENT_OFFLINE', 'PRESENT_ONLINE', 'ABSENT', 'PRESENT_ONLINE', 'PRESENT_ONLINE', 'PRESENT_OFFLINE', 'PRESENT_ONLINE', 'PRESENT_ONLINE', 'PRESENT_ONLINE'],
        maha: ['PRESENT_ONLINE', 'PRESENT_ONLINE', 'LEAVE', 'PRESENT_OFFLINE', 'PRESENT_ONLINE', 'ABSENT', 'PRESENT_ONLINE', 'PRESENT_ONLINE', 'PRESENT_OFFLINE', 'PRESENT_ONLINE'],
        mathavi: ['PRESENT_ONLINE', 'ABSENT', 'PRESENT_ONLINE', 'ABSENT', 'PRESENT_ONLINE', 'LEAVE', 'PRESENT_ONLINE', 'PRESENT_OFFLINE', 'PRESENT_ONLINE', 'PRESENT_ONLINE'],
    };
    for (const [key, plan] of Object.entries(attendancePlan)) {
        const studentId = studentIds[key];
        for (let i = 0; i < classDates.length; i += 1) {
            const exists = await row(
                'SELECT id FROM attendance WHERE batch_id = ? AND student_id = ? AND class_date = ?',
                [mainBatchId, studentId, classDates[i]],
            );
            if (exists) continue;
            await exec(
                `INSERT INTO attendance (batch_id, student_id, class_date, status, marked_by_trainer_id)
                 VALUES (?, ?, ?, ?, 1)`,
                [mainBatchId, studentId, classDates[i], plan[i]],
            );
            bump('attendance');
        }
    }

    // -----------------------------------------------------------------------
    // 5. Assignments + submissions (batch 1)
    // -----------------------------------------------------------------------
    const assignment1 = await ensureAssignment({
        batchId: mainBatchId, dayId: dayId[3], title: 'Responsive Landing Page',
        description: 'Build a responsive landing page with a navbar, hero section and 3 feature cards. Use Flexbox or Grid.',
        attachment: 'https://developer.mozilla.org/en-US/docs/Learn/CSS/CSS_layout', due: addDays(today, 5),
    });
    const assignment2 = await ensureAssignment({
        batchId: mainBatchId, dayId: dayId[6], title: 'JavaScript DOM Todo App',
        description: 'Create a todo list with add, complete and delete actions using DOM APIs (no frameworks).',
        attachment: null, due: addDays(today, 10),
    });
    await ensureAssignment({
        batchId: mainBatchId, dayId: dayId[9], title: 'React Dashboard UI',
        description: 'Recreate the dashboard mockup with reusable React components and mock JSON data.',
        attachment: null, due: addDays(today, 15),
    });

    const submissions = [
        [assignment1, studentIds.arun, 'https://github.com/demo-arun/responsive-landing-page', 92.5, 'Excellent layout and spacing. Minor issue: mobile navbar overflows at 360px.'],
        [assignment1, studentIds.maha, 'https://github.com/demo-maha/landing-page', 78, 'Good work. Add semantic tags and improve contrast for accessibility.'],
        [assignment2, studentIds.arun, 'https://github.com/demo-arun/js-todo-app', 85, 'Clean DOM logic. Consider splitting render functions.'],
    ];
    for (const [assignmentId, studentId, url, marks, feedback] of submissions) {
        const exists = await row(
            'SELECT id FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?',
            [assignmentId, studentId],
        );
        if (exists) continue;
        await exec(
            `INSERT INTO assignment_submissions (assignment_id, student_id, submission_file_url, marks_obtained, trainer_feedback)
             VALUES (?, ?, ?, ?, ?)`,
            [assignmentId, studentId, url, marks, feedback],
        );
        bump('assignment_submissions');
    }

    // -----------------------------------------------------------------------
    // 6. Tests + submissions (batch 1)
    // -----------------------------------------------------------------------
    const test1 = await ensureTest({
        batchId: mainBatchId, subject: 'Frontend', title: 'HTML & CSS Fundamentals Test',
        paperUrl: 'https://storage.example.com/tests/batch1-html-css.pdf',
        start: at(addDays(today, -3), 10), end: at(addDays(today, -3), 12), totalMarks: 50,
    });
    await ensureTest({
        batchId: mainBatchId, subject: 'JavaScript', title: 'JavaScript Weekly Assessment',
        paperUrl: 'https://storage.example.com/tests/batch1-js-weekly.pdf',
        start: at(addDays(today, 2), 10), end: at(addDays(today, 2), 12), totalMarks: 100,
    });

    const testSubmissions = [
        [test1, studentIds.arun, 'https://storage.example.com/answers/arun-test1.pdf', 44],
        [test1, studentIds.maha, 'https://storage.example.com/answers/maha-test1.pdf', 38],
    ];
    for (const [testId, studentId, url, marks] of testSubmissions) {
        const exists = await row(
            'SELECT id FROM test_submissions WHERE test_id = ? AND student_id = ?',
            [testId, studentId],
        );
        if (exists) continue;
        await exec(
            'INSERT INTO test_submissions (test_id, student_id, answer_sheet_url, marks_obtained) VALUES (?, ?, ?, ?)',
            [testId, studentId, url, marks],
        );
        bump('test_submissions');
    }

    // -----------------------------------------------------------------------
    // 7. Announcements
    // -----------------------------------------------------------------------
    await ensureAnnouncement({
        batchId: mainBatchId, userId: priyaUserId, pinned: true,
        title: 'Welcome to BATCH-2026-01 🎉',
        content: 'Welcome aboard! Classes run Monday to Friday, 10:00 AM - 11:30 AM. Please install VS Code, Node.js and MySQL Workbench before Day 1.',
    });
    await ensureAnnouncement({
        batchId: mainBatchId, userId: priyaUserId, pinned: false,
        title: 'JavaScript Weekly Test this week',
        content: 'The JavaScript assessment covers days 5-7: functions, arrays, DOM events and async/await. Total marks: 100.',
    });
    await ensureAnnouncement({
        batchId: mainBatchId, userId: priyaUserId, pinned: false,
        title: 'Assignment deadline extended',
        content: 'The Responsive Landing Page deadline is extended by 2 days. Submit your GitHub link from the Assignments tab.',
    });
    await ensureAnnouncement({
        batchId: kumariBatchId, userId: kumariUserId, pinned: true,
        title: 'Batch kickoff at 10 AM',
        content: 'Hi team, our first live session starts at 10 AM. Join using the Teams link in the Live Classes tab.',
    });
    await ensureAnnouncement({
        batchId: secondBatchId, userId: priyaUserId, pinned: false,
        title: 'Revision session scheduled',
        content: 'CSS layout revision session is scheduled this week. Check the Live Classes tab for the meeting link.',
    });

    // -----------------------------------------------------------------------
    // 8. Batch chat (everyone's conversation)
    // -----------------------------------------------------------------------
    const mainRoomId = await ensureChatRoom(mainBatchId);
    const conversation = [
        [priyaUserId, 'Good morning everyone! Today we start with CSS Flexbox.', 60],
        [arunUserId, 'Good morning maam!', 58],
        [mahaUserId, 'Ready for class 👍', 55],
        [mathaviUserId, 'Should we install VS Code before the session?', 52],
        [priyaUserId, 'Yes, please install VS Code and the Live Server extension.', 50],
        [arunUserId, 'Done maam, installed and ready.', 45],
        [mahaUserId, 'The flexbox exercise file is attached in Day 4 content, right?', 30],
        [priyaUserId, 'Correct. Complete it before tomorrow and share your GitHub link.', 28],
        [mathaviUserId, 'Got it, thank you!', 12],
    ];
    for (const [userId, message, minutesAgo] of conversation) {
        await ensureChatMessage(mainRoomId, userId, message, minutesAgo);
    }

    const secondRoomId = await ensureChatRoom(secondBatchId);
    await ensureChatMessage(secondRoomId, priyaUserId, 'Hi team! Revision class link is posted in Live Classes.', 120);
    await ensureChatMessage(secondRoomId, arunUserId, 'Thank you maam, joining.', 115);

    const kumariRoomId = await ensureChatRoom(kumariBatchId);
    await ensureChatMessage(kumariRoomId, kumariUserId, 'Hello team, share your doubts here during class.', 15);

    // -----------------------------------------------------------------------
    // 8b. Batch 3 (Kumari's batch) students + activity, so that batch is usable too
    // -----------------------------------------------------------------------
    const batch3StudentIds = {};
    const batch3UserIds = {};
    for (const [key, name, mobile] of [['vignesh', 'Vignesh', '9000000008'], ['deepa', 'Deepa', '9000000009']]) {
        const userId = await ensureUser(name, mobile, 'STUDENT');
        batch3UserIds[key] = userId;
        let s = await row('SELECT student_id FROM students WHERE user_id = ?', [userId]);
        if (!s) {
            const ins = await exec(
                'INSERT INTO students (user_id, joining_date, certification_status) VALUES (?, ?, ?)',
                [userId, dateOnly(addDays(today, -3)), 'PENDING'],
            );
            bump('students');
            s = { student_id: ins.insertId };
        }
        batch3StudentIds[key] = s.student_id;
        const enrolled = await exec(
            'INSERT IGNORE INTO batch_students (batch_id, student_id) VALUES (?, ?)',
            [kumariBatchId, s.student_id],
        );
        if (enrolled.affectedRows) bump('batch_students');
    }

    const b3Plan = {
        vignesh: ['PRESENT_ONLINE', 'PRESENT_ONLINE', 'PRESENT_OFFLINE', 'PRESENT_ONLINE', 'PRESENT_ONLINE'],
        deepa: ['PRESENT_ONLINE', 'PRESENT_ONLINE', 'PRESENT_ONLINE', 'ABSENT', 'PRESENT_ONLINE'],
    };
    for (const [key, plan] of Object.entries(b3Plan)) {
        for (let i = 0; i < 5; i += 1) {
            const exists = await row(
                'SELECT id FROM attendance WHERE batch_id = ? AND student_id = ? AND class_date = ?',
                [kumariBatchId, batch3StudentIds[key], classDates[i]],
            );
            if (exists) continue;
            await exec(
                `INSERT INTO attendance (batch_id, student_id, class_date, status, marked_by_trainer_id)
                 VALUES (?, ?, ?, ?, 2)`,
                [kumariBatchId, batch3StudentIds[key], classDates[i], plan[i]],
            );
            bump('attendance');
        }
    }

    // Grade the assignment that already exists in batch 3 ("html task").
    const b3Assignment = await row('SELECT id FROM assignments WHERE batch_id = ? AND title = ?', [kumariBatchId, 'html task']);
    if (b3Assignment) {
        for (const [studentId, url, marks, feedback] of [
            [batch3StudentIds.vignesh, 'https://github.com/demo-vignesh/html-task', 88, 'Nice semantic markup and clean indentation.'],
            [batch3StudentIds.deepa, 'https://github.com/demo-deepa/html-task', 72, 'Add alt text to images and fix the form labels.'],
        ]) {
            const exists = await row(
                'SELECT id FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?',
                [b3Assignment.id, studentId],
            );
            if (exists) continue;
            await exec(
                `INSERT INTO assignment_submissions (assignment_id, student_id, submission_file_url, marks_obtained, trainer_feedback)
                 VALUES (?, ?, ?, ?, ?)`,
                [b3Assignment.id, studentId, url, marks, feedback],
            );
            bump('assignment_submissions');
        }
    }

    const b3Test = await ensureTest({
        batchId: kumariBatchId, subject: 'Frontend', title: 'HTML Basics Quiz',
        paperUrl: 'https://storage.example.com/tests/batch3-html-quiz.pdf',
        start: at(addDays(today, -2), 14), end: at(addDays(today, -2), 15), totalMarks: 25,
    });
    for (const [studentId, url, marks] of [
        [batch3StudentIds.vignesh, 'https://storage.example.com/answers/vignesh-quiz.pdf', 22],
        [batch3StudentIds.deepa, 'https://storage.example.com/answers/deepa-quiz.pdf', 18],
    ]) {
        const exists = await row('SELECT id FROM test_submissions WHERE test_id = ? AND student_id = ?', [b3Test, studentId]);
        if (exists) continue;
        await exec(
            'INSERT INTO test_submissions (test_id, student_id, answer_sheet_url, marks_obtained) VALUES (?, ?, ?, ?)',
            [b3Test, studentId, url, marks],
        );
        bump('test_submissions');
    }

    await ensureChatMessage(kumariRoomId, batch3UserIds.vignesh, 'Good morning maam!', 10);
    await ensureChatMessage(kumariRoomId, batch3UserIds.deepa, 'Present maam 👍', 8);
    await ensureChatMessage(kumariRoomId, kumariUserId, 'Great, today we cover semantic HTML and forms.', 6);

    // -----------------------------------------------------------------------
    // 9. EMS: employees, attendance, leaves, trainings
    // -----------------------------------------------------------------------
    const manager = await ensureEmployee({
        name: 'Karthik Raman', mobile: '9000000006', deptId: 1, designationId: 2, code: 'EMP-ENG-2026-001',
        managerId: null, salary: 95000, joining: dateOnly(addDays(today, -220)),
        email: 'karthik.raman@lms.local', emergency: '9000000016', address: '12 Anna Nagar, Chennai',
    });
    const ravi = await ensureEmployee({
        name: 'Ravi Kumar', mobile: '9000000004', deptId: 1, designationId: 1, code: 'EMP-ENG-2026-002',
        managerId: manager.employeeId, salary: 55000, joining: dateOnly(addDays(today, -40)),
        email: 'ravi.kumar@lms.local', emergency: '9000000014', address: '45 T Nagar, Chennai',
    });
    const divya = await ensureEmployee({
        name: 'Divya Sharma', mobile: '9000000005', deptId: 2, designationId: 4, code: 'EMP-HR-2026-003',
        managerId: manager.employeeId, salary: 48000, joining: dateOnly(addDays(today, -90)),
        email: 'divya.sharma@lms.local', emergency: '9000000015', address: '8 Adyar, Chennai',
    });
    const sneha = await ensureEmployee({
        name: 'Sneha Iyer', mobile: '9000000007', deptId: 3, designationId: 6, code: 'EMP-QA-2026-004',
        managerId: manager.employeeId, salary: 62000, joining: dateOnly(addDays(today, -15)),
        email: 'sneha.iyer@lms.local', emergency: '9000000017', address: '22 Velachery, Chennai',
    });

    const emsPeople = [manager, ravi, divya, sneha];
    const workDays = [];
    cursor = new Date(today);
    while (workDays.length < 5) {
        const dow = cursor.getDay();
        if (dow !== 0 && dow !== 6) workDays.push(cursor);
        cursor = addDays(cursor, -1);
    }
    const modes = ['OFFICE', 'REMOTE', 'HYBRID', 'OFFICE'];
    for (let i = 0; i < workDays.length; i += 1) {
        const day = workDays[i];
        const isToday = i === 0;
        for (let idx = 0; idx < emsPeople.length; idx += 1) {
            const person = emsPeople[idx];
            const late = (idx + i) % 3 === 2;
            const absent = i === 2 && idx === 3; // Sneha absent one day
            const leave = i === 3 && idx === 2;  // Divya on leave one day
            let status = 'PRESENT';
            let checkIn = '09:15:00';
            let checkOut = '18:10:00';
            if (late) { status = 'LATE'; checkIn = '10:05:00'; }
            if (absent) { status = 'ABSENT'; checkIn = null; checkOut = null; }
            if (leave) { status = 'LEAVE'; checkIn = null; checkOut = null; }
            if (isToday && idx === 3) { checkOut = null; } // still working
            await ensureEmsAttendance({
                employeeId: person.employeeId,
                day: dateOnly(day),
                checkIn,
                checkOut,
                status,
                mode: modes[idx % modes.length],
                remarks: absent ? 'Unplanned absence' : leave ? 'Approved casual leave' : late ? 'Traffic delay' : null,
            });
        }
    }

    await ensureLeave({
        employeeId: ravi.employeeId, type: 'CASUAL', from: dateOnly(addDays(today, 4)), to: dateOnly(addDays(today, 4)),
        days: 1, reason: 'Family function at hometown.', status: 'PENDING', approvedBy: null, remarks: null,
    });
    await ensureLeave({
        employeeId: divya.employeeId, type: 'SICK', from: dateOnly(addDays(today, -1)), to: dateOnly(addDays(today, -1)),
        days: 1, reason: 'Fever and cold.', status: 'APPROVED', approvedBy: manager.employeeId, remarks: 'Approved. Take rest.',
    });
    await ensureLeave({
        employeeId: sneha.employeeId, type: 'EARNED', from: dateOnly(addDays(today, 10)), to: dateOnly(addDays(today, 12)),
        days: 3, reason: 'Annual vacation with family.', status: 'PENDING', approvedBy: null, remarks: null,
    });
    await ensureLeave({
        employeeId: sneha.employeeId, type: 'UNPAID', from: dateOnly(addDays(today, -8)), to: dateOnly(addDays(today, -8)),
        days: 1, reason: 'Personal errand.', status: 'REJECTED', approvedBy: manager.employeeId, remarks: 'Rejected due to release week.',
    });

    await ensureTraining({
        employeeId: ravi.employeeId, courseId: 1, batchId: mainBatchId, type: 'ONBOARDING',
        deadline: dateOnly(addDays(today, 45)), status: 'IN_PROGRESS', progress: 45, certIssued: false,
    });
    await ensureTraining({
        employeeId: divya.employeeId, courseId: 4, batchId: null, type: 'UPSKILLING',
        deadline: dateOnly(addDays(today, 30)), status: 'ENROLLED', progress: 0, certIssued: false,
    });
    await ensureTraining({
        employeeId: sneha.employeeId, courseId: 3, batchId: null, type: 'CERTIFICATION',
        deadline: dateOnly(addDays(today, -5)), status: 'COMPLETED', progress: 100, certIssued: true,
    });
    await ensureTraining({
        employeeId: manager.employeeId, courseId: 1, batchId: mainBatchId, type: 'LEADERSHIP',
        deadline: dateOnly(addDays(today, 60)), status: 'IN_PROGRESS', progress: 70, certIssued: false,
    });

    // -----------------------------------------------------------------------
    // 10. Certificates via the real API (generates the PDF file too)
    // -----------------------------------------------------------------------
    const certificates = [];
    for (const studentId of [studentIds.arun, studentIds.maha]) {
        try {
            const res = await fetch('http://localhost:5000/api/certificates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ student_id: studentId, batch_id: mainBatchId, course_completed: true }),
            });
            const body = await res.json();
            if (body.success) {
                certificates.push({ studentId, certificate: body.data.certificate_number, status: res.status });
            } else {
                console.log(`  ! certificate for student ${studentId}: ${body.message || body.error}`);
            }
        } catch {
            console.log(`  ! certificate for student ${studentId}: backend not reachable on :5000`);
        }
    }

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('Inserted missing demo rows:');
    const order = ['users', 'students', 'course_days', 'course_contents', 'live_classes', 'class_recordings',
        'attendance', 'assignments', 'assignment_submissions', 'tests', 'test_submissions', 'announcements',
        'chat_messages', 'ems_employees', 'ems_attendance', 'ems_leaves', 'ems_employee_trainings'];
    for (const table of order) console.log(`  ${table.padEnd(24)} +${stats[table] || 0}`);

    const counts = await rows(`
        SELECT 'batches' AS tbl, COUNT(*) AS n FROM batches
        UNION ALL SELECT 'students', COUNT(*) FROM students
        UNION ALL SELECT 'course_days', COUNT(*) FROM course_days
        UNION ALL SELECT 'course_contents', COUNT(*) FROM course_contents
        UNION ALL SELECT 'live_classes', COUNT(*) FROM live_classes
        UNION ALL SELECT 'class_recordings', COUNT(*) FROM class_recordings
        UNION ALL SELECT 'attendance', COUNT(*) FROM attendance
        UNION ALL SELECT 'assignments', COUNT(*) FROM assignments
        UNION ALL SELECT 'tests', COUNT(*) FROM tests
        UNION ALL SELECT 'announcements', COUNT(*) FROM announcements
        UNION ALL SELECT 'chat_rooms', COUNT(*) FROM chat_rooms
        UNION ALL SELECT 'chat_messages', COUNT(*) FROM chat_messages
        UNION ALL SELECT 'certificates', COUNT(*) FROM certificates
        UNION ALL SELECT 'ems_employees', COUNT(*) FROM ems_employees
        UNION ALL SELECT 'ems_attendance', COUNT(*) FROM ems_attendance
        UNION ALL SELECT 'ems_leaves', COUNT(*) FROM ems_leaves
        UNION ALL SELECT 'ems_employee_trainings', COUNT(*) FROM ems_employee_trainings`);
    console.log('\nCurrent totals:');
    for (const r of counts) console.log(`  ${r.tbl.padEnd(24)} ${r.n}`);
    if (certificates.length > 0) {
        console.log('\nCertificates ready to download:');
        for (const c of certificates) console.log(`  student ${c.studentId} -> ${c.certificate} (HTTP ${c.status})`);
    }
}

seed()
    .then(async () => {
        await conn.end();
        console.log('\nDemo data seeding complete ✅');
    })
    .catch(async (err) => {
        console.error('\nSeeding failed:', err.message);
        if (conn) await conn.end().catch(() => { });
        process.exit(1);
    });
