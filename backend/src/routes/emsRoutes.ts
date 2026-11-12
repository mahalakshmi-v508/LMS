import { Router } from 'express';
import {
    getDepartments,
    createDepartment,
    getDesignations,
    createDesignation,
    getEmployees,
    getEmployeeById,
    createEmployee,
    updateEmployee,
    getAttendance,
    checkIn,
    checkOut,
    getLeaves,
    applyLeave,
    updateLeaveStatus
} from '../controllers/emsController';

import {
    assignTrainingToEmployee,
    getEmployeeLearningProgress,
    getOrganizationTrainingSummary
} from '../controllers/emsBridgeController';

const router = Router();

// Departments
router.get('/departments', getDepartments);
router.post('/departments', createDepartment);

// Designations
router.get('/designations', getDesignations);
router.post('/designations', createDesignation);

// Employees Master Directory
router.get('/employees', getEmployees);
router.get('/employees/:id', getEmployeeById);
router.post('/employees', createEmployee);
router.put('/employees/:id', updateEmployee);

// Attendance
router.get('/attendance', getAttendance);
router.post('/attendance/check-in', checkIn);
router.post('/attendance/check-out', checkOut);

// Leaves
router.get('/leaves', getLeaves);
router.post('/leaves', applyLeave);
router.put('/leaves/:id/status', updateLeaveStatus);

// LMS ↔ EMS Bridge / Upskilling
router.post('/trainings/assign', assignTrainingToEmployee);
router.get('/trainings/employee/:id', getEmployeeLearningProgress);
router.get('/trainings/summary', getOrganizationTrainingSummary);

export default router;
