const BASE_URL = 'http://localhost:5000/api';

async function runEMSTests() {
    console.log('🧪 Starting EMS & LMS Integration API Tests...\n');
    let passed = 0;
    let failed = 0;

    async function test(name: string, fn: () => Promise<void>) {
        try {
            await fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err: any) {
            console.error(`  ❌ [FAIL] ${name}:`, err.message);
            failed++;
        }
    }

    let sampleDeptId = 1;
    let sampleDesigId = 1;
    let createdEmpId = 0;
    let sampleBatchId = 2; // Default existing batch
    let sampleCourseId = 1;

    // 1. Departments
    await test('GET /api/ems/departments', async () => {
        const res = await fetch(`${BASE_URL}/ems/departments`);
        const json = await res.json();
        if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
            throw new Error('Failed to retrieve departments');
        }
        sampleDeptId = json.data[0].id;
    });

    // 2. Designations
    await test('GET /api/ems/designations', async () => {
        const res = await fetch(`${BASE_URL}/ems/designations?department_id=${sampleDeptId}`);
        const json = await res.json();
        if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
            throw new Error('Failed to retrieve designations');
        }
        sampleDesigId = json.data[0].id;
    });

    // 3. Employee Creation (with LMS auto-provisioning)
    const testMobile = '98765' + Math.floor(10000 + Math.random() * 90000);
    await test('POST /api/ems/employees (Create Employee & Auto-create LMS Account)', async () => {
        const res = await fetch(`${BASE_URL}/ems/employees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Karthik Raja',
                mobile_number: testMobile,
                work_email: `karthik.${testMobile}@company.com`,
                department_id: sampleDeptId,
                designation_id: sampleDesigId,
                employment_type: 'FULL_TIME',
                status: 'ACTIVE',
                salary_monthly: 65000,
                initial_course_id: sampleCourseId,
                initial_batch_id: sampleBatchId
            })
        });
        const json = await res.json();
        if (!json.success || !json.data?.id) {
            throw new Error(json.message || json.error || 'Failed to create employee');
        }
        createdEmpId = json.data.id;
        console.log(`     ℹ️ Created Employee: ${json.data.employee_code} (ID: ${createdEmpId}, LMS User ID: ${json.data.user_id})`);
    });

    // 4. Employee List
    await test('GET /api/ems/employees', async () => {
        const res = await fetch(`${BASE_URL}/ems/employees`);
        const json = await res.json();
        if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
            throw new Error('Failed to fetch employees list');
        }
    });

    // 5. Employee Details with LMS Bridge
    await test('GET /api/ems/employees/:id', async () => {
        const res = await fetch(`${BASE_URL}/ems/employees/${createdEmpId}`);
        const json = await res.json();
        if (!json.success || json.data.id !== createdEmpId) {
            throw new Error('Failed to get employee by ID');
        }
        if (!Array.isArray(json.data.trainings)) {
            throw new Error('Trainings bridge data missing');
        }
    });

    // 6. Attendance Check-in
    await test('POST /api/ems/attendance/check-in', async () => {
        const res = await fetch(`${BASE_URL}/ems/attendance/check-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employee_id: createdEmpId,
                work_mode: 'OFFICE',
                remarks: 'Morning check-in at HQ'
            })
        });
        const json = await res.json();
        if (!json.success || !json.data) {
            throw new Error(json.message || 'Check-in failed');
        }
    });

    // 7. Attendance List
    await test('GET /api/ems/attendance', async () => {
        const res = await fetch(`${BASE_URL}/ems/attendance?employee_id=${createdEmpId}`);
        const json = await res.json();
        if (!json.success || !Array.isArray(json.data)) {
            throw new Error('Failed to fetch attendance');
        }
    });

    // 8. Leave Application
    let leaveId = 0;
    await test('POST /api/ems/leaves', async () => {
        const res = await fetch(`${BASE_URL}/ems/leaves`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employee_id: createdEmpId,
                leave_type: 'CASUAL',
                from_date: '2026-09-20',
                to_date: '2026-09-21',
                total_days: 2,
                reason: 'Family function'
            })
        });
        const json = await res.json();
        if (!json.success || !json.data?.id) {
            throw new Error(json.message || 'Failed to submit leave');
        }
        leaveId = json.data.id;
    });

    // 9. Leave Approval
    await test('PUT /api/ems/leaves/:id/status (Approve Leave)', async () => {
        const res = await fetch(`${BASE_URL}/ems/leaves/${leaveId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'APPROVED',
                action_remarks: 'Approved by HR Manager'
            })
        });
        const json = await res.json();
        if (!json.success || json.data.status !== 'APPROVED') {
            throw new Error(json.message || 'Failed to approve leave');
        }
    });

    // 10. LMS Training Bridge Progress
    await test('GET /api/ems/trainings/employee/:id', async () => {
        const res = await fetch(`${BASE_URL}/ems/trainings/employee/${createdEmpId}`);
        const json = await res.json();
        if (!json.success || !json.data.trainings) {
            throw new Error('Failed to fetch training progress');
        }
    });

    // 11. Organization Training Analytics
    await test('GET /api/ems/trainings/summary', async () => {
        const res = await fetch(`${BASE_URL}/ems/trainings/summary`);
        const json = await res.json();
        if (!json.success || !json.data.overview) {
            throw new Error('Failed to fetch organization training summary');
        }
        console.log(`     ℹ️ Total Employees: ${json.data.overview.total_employees}, Employees in Training: ${json.data.overview.employees_in_training}`);
    });

    console.log(`\n🏁 Test Suite Finished: ${passed} passed, ${failed} failed.\n`);
    process.exit(failed > 0 ? 1 : 0);
}

runEMSTests();
