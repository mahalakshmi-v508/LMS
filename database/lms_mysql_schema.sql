-- ======================================================================================
-- Custom LMS - Complete MySQL Schema (MySQL 8.0+)
-- ======================================================================================
-- How to use in MySQL Workbench:
--   1. Open MySQL Workbench and connect to your local MySQL server.
--   2. File -> Open SQL Script -> select this file.
--   3. Click the lightning bolt (Execute) to run the whole script.
--   4. The script creates the `LMS` database (if needed), all tables and seed data.
--
-- The script is idempotent: running it again will not drop existing data.
-- ======================================================================================

CREATE DATABASE IF NOT EXISTS `LMS`
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE `LMS`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ======================================================================================
-- 1. CORE LMS TABLES
-- ======================================================================================

-- Users: single credentials table shared by LMS + EMS (role decides the portal)
CREATE TABLE IF NOT EXISTS `users` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `mobile_number` VARCHAR(15) NOT NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'STUDENT',
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_mobile_number` (`mobile_number`),
    CONSTRAINT `ck_users_role` CHECK (`role` IN ('ADMIN', 'TRAINER', 'STUDENT', 'HR_ADMIN', 'EMPLOYEE', 'MANAGER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6-digit OTP codes used for mobile login
CREATE TABLE IF NOT EXISTS `user_otps` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `mobile_number` VARCHAR(15) NOT NULL,
    `otp_code` VARCHAR(10) NOT NULL,
    `expires_at` DATETIME NOT NULL,
    `is_used` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_user_otps_lookup` (`mobile_number`, `otp_code`, `is_used`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Student profile (extends users)
CREATE TABLE IF NOT EXISTS `students` (
    `student_id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `joining_date` DATE NULL,
    `certification_status` VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    PRIMARY KEY (`student_id`),
    UNIQUE KEY `uq_students_user_id` (`user_id`),
    CONSTRAINT `fk_students_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trainer profile (extends users)
CREATE TABLE IF NOT EXISTS `trainers` (
    `trainer_id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `specialization` VARCHAR(100) NULL,
    PRIMARY KEY (`trainer_id`),
    UNIQUE KEY `uq_trainers_user_id` (`user_id`),
    CONSTRAINT `fk_trainers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Courses
CREATE TABLE IF NOT EXISTS `courses` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `course_name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `duration_days` INT NOT NULL DEFAULT 60,
    `course_image_url` TEXT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_courses_course_name` (`course_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Batches (cohort = course + trainer + dates)
CREATE TABLE IF NOT EXISTS `batches` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `batch_code` VARCHAR(50) NOT NULL,
    `course_id` INT NOT NULL,
    `trainer_id` INT NOT NULL,
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_batches_batch_code` (`batch_code`),
    KEY `idx_batches_course` (`course_id`),
    KEY `idx_batches_trainer` (`trainer_id`),
    CONSTRAINT `fk_batches_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`),
    CONSTRAINT `fk_batches_trainer` FOREIGN KEY (`trainer_id`) REFERENCES `trainers` (`trainer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Enrollment association between students and batches
CREATE TABLE IF NOT EXISTS `batch_students` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `batch_id` INT NOT NULL,
    `student_id` INT NOT NULL,
    `assigned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_batch_students` (`batch_id`, `student_id`),
    KEY `idx_batch_students_student` (`student_id`),
    CONSTRAINT `fk_batch_students_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_batch_students_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Curriculum day (Day 1..60) for a course
CREATE TABLE IF NOT EXISTS `course_days` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `course_id` INT NOT NULL,
    `day_number` INT NOT NULL,
    `title` VARCHAR(150) NULL,
    `summary` TEXT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_course_days` (`course_id`, `day_number`),
    CONSTRAINT `fk_course_days_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Learning material attached to a curriculum day
CREATE TABLE IF NOT EXISTS `course_contents` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `course_day_id` INT NOT NULL,
    `title` VARCHAR(200) NULL,
    `rich_text_content` LONGTEXT NULL,
    `video_url` TEXT NULL,
    `attachment_url` TEXT NULL,
    `is_published` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_course_contents_day` (`course_day_id`),
    CONSTRAINT `fk_course_contents_day` FOREIGN KEY (`course_day_id`) REFERENCES `course_days` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scheduled live classes (Microsoft Teams link)
CREATE TABLE IF NOT EXISTS `live_classes` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `batch_id` INT NOT NULL,
    `course_day_id` INT NULL,
    `class_topic` VARCHAR(200) NOT NULL,
    `teams_meeting_link` TEXT NULL,
    `start_time` DATETIME NOT NULL,
    `end_time` DATETIME NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_live_classes_batch` (`batch_id`),
    KEY `idx_live_classes_day` (`course_day_id`),
    CONSTRAINT `fk_live_classes_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_live_classes_day` FOREIGN KEY (`course_day_id`) REFERENCES `course_days` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Recordings with 60-day retention
CREATE TABLE IF NOT EXISTS `class_recordings` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `live_class_id` INT NOT NULL,
    `storage_blob_path` TEXT NULL,
    `duration_minutes` INT NULL,
    `expiry_date` DATETIME NULL,
    `is_available` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_class_recordings_live_class` (`live_class_id`),
    CONSTRAINT `fk_class_recordings_live_class` FOREIGN KEY (`live_class_id`) REFERENCES `live_classes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hybrid attendance (PRESENT_ONLINE / PRESENT_OFFLINE / ABSENT / LEAVE)
CREATE TABLE IF NOT EXISTS `attendance` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `batch_id` INT NOT NULL,
    `student_id` INT NOT NULL,
    `class_date` DATE NOT NULL,
    `status` VARCHAR(50) NOT NULL,
    `marked_by_trainer_id` INT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_attendance` (`batch_id`, `student_id`, `class_date`),
    KEY `idx_attendance_student` (`student_id`),
    CONSTRAINT `fk_attendance_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_attendance_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE,
    CONSTRAINT `fk_attendance_trainer` FOREIGN KEY (`marked_by_trainer_id`) REFERENCES `trainers` (`trainer_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Assignments
CREATE TABLE IF NOT EXISTS `assignments` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `batch_id` INT NOT NULL,
    `course_day_id` INT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `file_attachment_url` TEXT NULL,
    `due_date` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_assignments_batch` (`batch_id`),
    KEY `idx_assignments_day` (`course_day_id`),
    CONSTRAINT `fk_assignments_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_assignments_day` FOREIGN KEY (`course_day_id`) REFERENCES `course_days` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Assignment submissions and grading
CREATE TABLE IF NOT EXISTS `assignment_submissions` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `assignment_id` INT NOT NULL,
    `student_id` INT NOT NULL,
    `submission_file_url` TEXT NULL,
    `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `marks_obtained` DECIMAL(5,2) NULL,
    `trainer_feedback` TEXT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_assignment_submissions` (`assignment_id`, `student_id`),
    KEY `idx_assignment_submissions_student` (`student_id`),
    CONSTRAINT `fk_assignment_submissions_assignment` FOREIGN KEY (`assignment_id`) REFERENCES `assignments` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_assignment_submissions_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Weekly tests
CREATE TABLE IF NOT EXISTS `tests` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `batch_id` INT NOT NULL,
    `subject` VARCHAR(100) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `test_paper_url` TEXT NULL,
    `start_time` DATETIME NULL,
    `end_time` DATETIME NULL,
    `total_marks` INT NOT NULL DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_tests_batch` (`batch_id`),
    CONSTRAINT `fk_tests_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test submissions and grading
CREATE TABLE IF NOT EXISTS `test_submissions` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `test_id` INT NOT NULL,
    `student_id` INT NOT NULL,
    `answer_sheet_url` TEXT NULL,
    `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `marks_obtained` DECIMAL(5,2) NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_test_submissions` (`test_id`, `student_id`),
    KEY `idx_test_submissions_student` (`student_id`),
    CONSTRAINT `fk_test_submissions_test` FOREIGN KEY (`test_id`) REFERENCES `tests` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_test_submissions_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Announcement / message board
CREATE TABLE IF NOT EXISTS `announcements` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `batch_id` INT NOT NULL,
    `created_by_user_id` INT NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NULL,
    `is_pinned` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_announcements_batch` (`batch_id`),
    CONSTRAINT `fk_announcements_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_announcements_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Batch chat room with an active time window
CREATE TABLE IF NOT EXISTS `chat_rooms` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `batch_id` INT NOT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `active_from` DATETIME NULL,
    `active_until` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_chat_rooms_batch` (`batch_id`),
    CONSTRAINT `fk_chat_rooms_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Chat messages
CREATE TABLE IF NOT EXISTS `chat_messages` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `chat_room_id` INT NOT NULL,
    `sender_user_id` INT NOT NULL,
    `message` TEXT NOT NULL,
    `sent_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_chat_messages_room` (`chat_room_id`),
    CONSTRAINT `fk_chat_messages_room` FOREIGN KEY (`chat_room_id`) REFERENCES `chat_rooms` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_chat_messages_user` FOREIGN KEY (`sender_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Generated completion certificates
CREATE TABLE IF NOT EXISTS `certificates` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `certificate_number` VARCHAR(100) NOT NULL,
    `student_id` INT NOT NULL,
    `batch_id` INT NOT NULL,
    `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `recipient_name` VARCHAR(150) NULL,
    `course_title` VARCHAR(200) NULL,
    `batch_label` VARCHAR(80) NULL,
    `pdf_url` VARCHAR(500) NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_certificates_number` (`certificate_number`),
    KEY `idx_certificates_student_batch` (`student_id`, `batch_id`),
    CONSTRAINT `fk_certificates_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE,
    CONSTRAINT `fk_certificates_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ======================================================================================
-- 2. EMS (EMPLOYEE MANAGEMENT SYSTEM) TABLES
-- ======================================================================================

CREATE TABLE IF NOT EXISTS `ems_departments` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `description` VARCHAR(255) NULL,
    `head_employee_id` INT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_ems_departments_name` (`name`),
    UNIQUE KEY `uq_ems_departments_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ems_designations` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `department_id` INT NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `grade_level` VARCHAR(20) NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_ems_designations` (`department_id`, `title`),
    CONSTRAINT `fk_ems_designations_department` FOREIGN KEY (`department_id`) REFERENCES `ems_departments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ems_employees` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `employee_code` VARCHAR(50) NOT NULL,
    `department_id` INT NOT NULL,
    `designation_id` INT NOT NULL,
    `reporting_manager_id` INT NULL,
    `employment_type` VARCHAR(30) NOT NULL DEFAULT 'FULL_TIME',
    `status` VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    `date_of_joining` DATE NOT NULL,
    `work_email` VARCHAR(150) NULL,
    `emergency_contact` VARCHAR(50) NULL,
    `address` TEXT NULL,
    `salary_monthly` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_ems_employees_user` (`user_id`),
    UNIQUE KEY `uq_ems_employees_code` (`employee_code`),
    KEY `idx_ems_employees_department` (`department_id`),
    KEY `idx_ems_employees_designation` (`designation_id`),
    KEY `idx_ems_employees_manager` (`reporting_manager_id`),
    CONSTRAINT `fk_ems_employees_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_ems_employees_department` FOREIGN KEY (`department_id`) REFERENCES `ems_departments` (`id`),
    CONSTRAINT `fk_ems_employees_designation` FOREIGN KEY (`designation_id`) REFERENCES `ems_designations` (`id`),
    CONSTRAINT `fk_ems_employees_manager` FOREIGN KEY (`reporting_manager_id`) REFERENCES `ems_employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ems_attendance` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `employee_id` INT NOT NULL,
    `attendance_date` DATE NOT NULL,
    `check_in_time` TIME NULL,
    `check_out_time` TIME NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PRESENT',
    `work_mode` VARCHAR(20) NOT NULL DEFAULT 'OFFICE',
    `remarks` VARCHAR(255) NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_ems_attendance_emp_date` (`employee_id`, `attendance_date`),
    CONSTRAINT `fk_ems_attendance_employee` FOREIGN KEY (`employee_id`) REFERENCES `ems_employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ems_leaves` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `employee_id` INT NOT NULL,
    `leave_type` VARCHAR(30) NOT NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NOT NULL,
    `total_days` DECIMAL(4,1) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `approved_by` INT NULL,
    `action_remarks` VARCHAR(255) NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_ems_leaves_employee` (`employee_id`),
    KEY `idx_ems_leaves_status` (`status`),
    CONSTRAINT `fk_ems_leaves_employee` FOREIGN KEY (`employee_id`) REFERENCES `ems_employees` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_ems_leaves_approver` FOREIGN KEY (`approved_by`) REFERENCES `ems_employees` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- LMS <-> EMS bridge: employee training enrollments
CREATE TABLE IF NOT EXISTS `ems_employee_trainings` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `employee_id` INT NOT NULL,
    `course_id` INT NOT NULL,
    `batch_id` INT NULL,
    `training_type` VARCHAR(50) NOT NULL DEFAULT 'ONBOARDING',
    `enrollment_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
    `completion_deadline` DATE NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'ENROLLED',
    `progress_percentage` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    `certification_issued` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_ems_emp_training` (`employee_id`, `course_id`, `batch_id`),
    KEY `idx_ems_trainings_course` (`course_id`),
    KEY `idx_ems_trainings_batch` (`batch_id`),
    CONSTRAINT `fk_ems_trainings_employee` FOREIGN KEY (`employee_id`) REFERENCES `ems_employees` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_ems_trainings_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`),
    CONSTRAINT `fk_ems_trainings_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ======================================================================================
-- 3. SEED DATA (safe to re-run)
-- ======================================================================================

INSERT IGNORE INTO `ems_departments` (`name`, `code`, `description`) VALUES
('Software Engineering', 'ENG', 'Product Development and Architecture'),
('Human Resources', 'HR', 'People Operations, Talent and Culture'),
('Quality Assurance', 'QA', 'Testing, Automation and Quality Engineering'),
('Product & Design', 'PROD', 'UI/UX Design and Product Strategy'),
('Business & Sales', 'SALES', 'Client Acquisition and Customer Success');

INSERT IGNORE INTO `ems_designations` (`department_id`, `title`, `grade_level`)
SELECT d.id, x.title, x.grade_level
FROM `ems_departments` d
JOIN (
    SELECT 'ENG' AS code, 'Junior Full Stack Developer' AS title, 'L1' AS grade_level
    UNION ALL SELECT 'ENG', 'Senior Full Stack Developer', 'L2'
    UNION ALL SELECT 'ENG', 'Lead Software Architect', 'L3'
    UNION ALL SELECT 'HR', 'HR Executive', 'L1'
    UNION ALL SELECT 'HR', 'HR Operations Manager', 'L2'
    UNION ALL SELECT 'QA', 'QA Automation Engineer', 'L1'
    UNION ALL SELECT 'QA', 'Senior Test Analyst', 'L2'
    UNION ALL SELECT 'PROD', 'UI/UX Designer', 'L1'
    UNION ALL SELECT 'PROD', 'Product Manager', 'L2'
) x ON x.code = d.code;

-- --------------------------------------------------------------------------------------
-- Optional demo data so the app has something to show on first run.
-- Remove / comment out this block if you are importing your own data.
-- --------------------------------------------------------------------------------------
INSERT IGNORE INTO `users` (`id`, `name`, `mobile_number`, `role`, `is_active`) VALUES
(1, 'System Admin', '9000000001', 'ADMIN', 1),
(2, 'Priya Trainer', '9000000002', 'TRAINER', 1),
(3, 'Arun Student', '9000000003', 'STUDENT', 1);

INSERT IGNORE INTO `trainers` (`trainer_id`, `user_id`, `specialization`) VALUES
(1, 2, 'Full Stack Development');

INSERT IGNORE INTO `students` (`student_id`, `user_id`, `joining_date`, `certification_status`) VALUES
(1, 3, CURRENT_DATE, 'PENDING');

INSERT IGNORE INTO `courses` (`id`, `course_name`, `description`, `duration_days`, `is_active`) VALUES
(1, 'Full Stack Development', '60-day hands-on full stack program covering frontend, backend and databases.', 60, 1);

INSERT IGNORE INTO `batches` (`id`, `batch_code`, `course_id`, `trainer_id`, `start_date`, `end_date`, `is_active`) VALUES
(1, 'BATCH-2026-01', 1, 1, CURRENT_DATE, DATE_ADD(CURRENT_DATE, INTERVAL 60 DAY), 1);

INSERT IGNORE INTO `batch_students` (`batch_id`, `student_id`) VALUES
(1, 1);

-- ======================================================================================
-- Done. You can now start the backend with `npm run dev` inside the backend folder.
-- ======================================================================================
