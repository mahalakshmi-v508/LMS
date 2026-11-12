// test-apis.js
const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
    console.log('🚀 Starting LMS API Validation Suite...\n');
    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}:`, err.message);
            failed++;
        }
    }

    // 1. Authentication (OTP)
    let otpCode = '';
    await test('POST /api/auth/send-otp', async () => {
        const res = await fetch(`${BASE_URL}/auth/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile_number: '9090909090' })
        });
        const json = await res.json();
        if (!json.success || !json.otp_code) throw new Error(json.message || 'Failed to send OTP');
        otpCode = json.otp_code;
    });

    await test('POST /api/auth/verify-otp', async () => {
        const res = await fetch(`${BASE_URL}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile_number: '9090909090', otp_code: otpCode })
        });
        const json = await res.json();
        if (!json.success || !json.data) throw new Error(json.message || 'Failed to verify OTP');
    });

    // 2. Curriculum & Batches
    await test('GET /api/courses/1/days', async () => {
        const res = await fetch(`${BASE_URL}/courses/1/days`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Failed');
    });

    await test('GET /api/batches', async () => {
        const res = await fetch(`${BASE_URL}/batches`);
        const json = await res.json();
        if (!json.success || !Array.isArray(json.data)) throw new Error('Failed');
    });

    await test('GET /api/batches/2', async () => {
        const res = await fetch(`${BASE_URL}/batches/2`);
        const json = await res.json();
        if (!json.success || !json.data) throw new Error('Failed');
    });

    await test('GET /api/batches/2/students', async () => {
        const res = await fetch(`${BASE_URL}/batches/2/students`);
        const json = await res.json();
        if (!json.success) throw new Error('Failed');
    });

    // 3. Live Classes & Recordings
    let liveClassId = 0;
    await test('POST /api/live-classes', async () => {
        const res = await fetch(`${BASE_URL}/live-classes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                batch_id: 2,
                course_day_id: 1,
                class_topic: 'Python Basics & Setup',
                teams_meeting_link: 'https://teams.microsoft.com/l/meetup-join/sample',
                start_time: new Date().toISOString(),
                end_time: new Date(Date.now() + 3600000).toISOString()
            })
        });
        const json = await res.json();
        if (!json.success || !json.data.id) throw new Error(json.message || 'Failed');
        liveClassId = json.data.id;
    });

    await test('GET /api/batches/2/live-classes', async () => {
        const res = await fetch(`${BASE_URL}/batches/2/live-classes`);
        const json = await res.json();
        if (!json.success) throw new Error('Failed');
    });

    await test('PUT /api/live-classes/:id/status', async () => {
        const res = await fetch(`${BASE_URL}/live-classes/${liveClassId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'COMPLETED' })
        });
        const json = await res.json();
        if (!json.success || json.data.status !== 'COMPLETED') throw new Error('Failed');
    });

    await test('POST /api/live-classes/:id/recordings (60-day expiry check)', async () => {
        const res = await fetch(`${BASE_URL}/live-classes/${liveClassId}/recordings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                storage_blob_path: 'https://lmsstorage.blob.core.windows.net/recordings/class_1.mp4',
                duration_minutes: 60
            })
        });
        const json = await res.json();
        if (!json.success || !json.data.expiry_date) throw new Error('Failed');
    });

    await test('GET /api/batches/2/recordings', async () => {
        const res = await fetch(`${BASE_URL}/batches/2/recordings`);
        const json = await res.json();
        if (!json.success || !Array.isArray(json.data)) throw new Error('Failed');
    });

    // 4. Hybrid Attendance
    await test('POST /api/attendance (Hybrid status)', async () => {
        const res = await fetch(`${BASE_URL}/attendance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                batch_id: 2,
                class_date: new Date().toISOString().split('T')[0],
                marked_by_trainer_id: 11,
                records: [
                    { student_id: 2, status: 'Present - Online' }
                ]
            })
        });
        const json = await res.json();
        if (!json.success || json.count === 0) throw new Error(json.message || 'Failed');
    });

    await test('GET /api/batches/2/attendance', async () => {
        const res = await fetch(`${BASE_URL}/batches/2/attendance`);
        const json = await res.json();
        if (!json.success) throw new Error('Failed');
    });

    await test('GET /api/students/2/attendance (Percentage check)', async () => {
        const res = await fetch(`${BASE_URL}/students/2/attendance`);
        const json = await res.json();
        if (!json.success || json.attendance_percentage === undefined) throw new Error('Failed');
    });

    // 5. Assignments
    let assignmentId = 0;
    await test('POST /api/assignments', async () => {
        const res = await fetch(`${BASE_URL}/assignments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                batch_id: 2,
                course_day_id: 1,
                title: 'Variables & Data Types Homework',
                description: 'Complete questions 1 to 5',
                file_attachment_url: 'https://example.com/homework1.pdf',
                due_date: new Date(Date.now() + 86400000 * 3).toISOString()
            })
        });
        const json = await res.json();
        if (!json.success || !json.data.id) throw new Error(json.message || 'Failed');
        assignmentId = json.data.id;
    });

    await test('POST /api/assignments/:id/submit', async () => {
        const res = await fetch(`${BASE_URL}/assignments/${assignmentId}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_id: 2,
                submission_file_url: 'https://example.com/student2_solution.py'
            })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'Failed');
    });

    // 6. Announcements
    await test('POST /api/announcements', async () => {
        const res = await fetch(`${BASE_URL}/announcements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                batch_id: 2,
                created_by_user_id: 1,
                title: 'Welcome to Batch PY-2026',
                content: 'Class starts today at 6:00 PM on Microsoft Teams.',
                is_pinned: true
            })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'Failed');
    });

    await test('GET /api/batches/2/announcements', async () => {
        const res = await fetch(`${BASE_URL}/batches/2/announcements`);
        const json = await res.json();
        if (!json.success) throw new Error('Failed');
    });

    // 7. Chat Room with Timer
    await test('POST /api/batches/2/chat-room (Activate with timer)', async () => {
        const res = await fetch(`${BASE_URL}/batches/2/chat-room`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                is_active: true,
                active_from: new Date(Date.now() - 60000).toISOString(),
                active_until: new Date(Date.now() + 3600000).toISOString()
            })
        });
        const json = await res.json();
        if (!json.success) throw new Error('Failed');
    });

    await test('GET /api/batches/2/chat-room (Verify open status)', async () => {
        const res = await fetch(`${BASE_URL}/batches/2/chat-room`);
        const json = await res.json();
        if (!json.success || json.data.is_currently_open !== 1) throw new Error('Room should be open');
    });

    // 8. Certificates
    await test('POST /api/certificates', async () => {
        const res = await fetch(`${BASE_URL}/certificates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_id: 2,
                batch_id: 2,
                pdf_url: 'https://example.com/certificates/cert_s2_b2.pdf'
            })
        });
        const json = await res.json();
        if (!json.success || !json.data.certificate_number) throw new Error('Failed');
    });

    await test('GET /api/students/2/certificates', async () => {
        const res = await fetch(`${BASE_URL}/students/2/certificates`);
        const json = await res.json();
        if (!json.success || !Array.isArray(json.data)) throw new Error('Failed');
    });

    console.log(`\n========================================`);
    console.log(`✨ Total Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`========================================\n`);
}

runTests().catch(console.error);
