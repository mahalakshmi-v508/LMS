# Custom LMS – Phase 1 Release Notes

**Product Version:** `v1.0.0-release`  
**Release Date:** September 16, 2026  
**Status:** Production-Ready Base System (Phase 1 Delivered)  
**Repository Structure:**
* **Backend:** [`lms-backend/`](file:///d:/LMS-Project/lms-backend) (Node.js, Express, TypeScript, MySQL 8)
* **Frontend:** [`lms-frontend/`](file:///d:/LMS-Project/lms-frontend) (React, Vite, TypeScript, Vanilla CSS Design System)

---

## 1. Executive Summary

This release delivers the complete **Phase 1 Production Base LMS** designed in accordance with the *Custom LMS – Developer Module & Technical Requirement Specification*. 

Unlike generic course-content websites, this system is purpose-built for **cohort/batch-based learning** and **hybrid classrooms** (where some students attend physically in-person, some join live online, and absent students catch up via recordings). Access control is strictly enforced on both frontend and backend following the security model:  
`User → Role → Batch → Course → Resource`.

---

## 2. Core Functional Modules Delivered

### 2.1. Authentication & User Management (§ 3 & § 4)
* **Mobile OTP Login Flow:** No mandatory email required. Users log in with a registered mobile number, generate a 6-digit numeric OTP with a 5-minute expiry window, and authenticate into their respective portal.
* **Role-Based Routing:** Seamlessly redirects authenticated users to their authorized workspace (`ADMIN`, `TRAINER`, or `STUDENT`).
* **Instant Demo Bypass (Dev/Demo Mode):** One-click demo credential switcher directly on the login screen to easily inspect and test all 3 user roles.

### 2.2. Admin Portal (§ 2, 4, 5, 6, 7, 20)
* **Executive Metrics Dashboard:** Real-time summary cards tracking Total Students, Active Batches, Trainers, and Active Courses.
* **Student Directory & Profiles:** View student rosters, registration dates, contact numbers, and batch enrollment status.
* **Trainer Management:** View trainers and assign instructors with specialized domain expertise.
* **Course Catalog:** Create courses with configurable duration (default 60 days), descriptions, and cover image URLs.
* **Batch Orchestration:** Create new batches, assign courses and trainers, configure start/end calendars, and assign student rosters.
* **60-Day Curriculum Builder:** Interactive course timeline editor from **Day 1 to Day 60**, supporting rich text study notes, video lectures, and downloadable PDF/file resources.

### 2.3. Trainer Portal (§ 2, 8, 9, 10, 13, 14, 15, 16, 17, 21)
* **Assigned Batch Switcher:** Dynamic switcher allowing trainers to manage multiple assigned batches independently.
* **Microsoft Teams Live Classroom:** Schedule live sessions with direct corporate Microsoft Teams meeting link generation, scheduled times, and class topics.
* **60-Day Recording Vault:** Add recorded lecture URLs with automatic **60-day retention countdown badges**.
* **Hybrid Attendance Register:** Batch attendance register with 1-click status selection:
  * `Present - Online`
  * `Present - Offline`
  * `Absent`
  * `Leave`
* **Day-Wise Assignments Desk:** Create assignments linked to specific syllabus days with due dates, inspect student file submissions, and provide marks with feedback.
* **Weekly Subject Test Papers:** Upload subject-wise test papers and evaluate student answer sheet submissions.
* **Realtime Batch Chat & Availability Timer:** Master toggle to open/close chat with an **availability timer** (`active_from` to `active_until`) so trainers can limit chat to class hours.
* **Message Board & Broadcasts:** Post urgent batch announcements with optional pinned notice support.

### 2.4. Student Portal (§ 2, 3, 8, 9, 11, 12, 13, 14, 15, 16, 17, 19, 22)
* **Day-Wise Interactive Classroom (Day 1..60):** Day-by-day learning timeline with lecture notes, video streaming, and downloadable attachments.
* **Live Classroom Launchpad:** One-click launch into scheduled Microsoft Teams live meetings.
* **Class Recording Player:** On-demand access to past lecture recordings within the 60-day retention window.
* **My Attendance & Gauge:** Personal attendance history calendar, online vs offline breakdown, and **attendance percentage** calculation (aiming for 75%+ eligibility).
* **Assignment Submissions:** Download assignment briefs and submit solution URLs.
* **Weekly Test Center:** Download test papers and submit answer sheets.
* **Batch Chat:** Real-time conversation stream with peers and the trainer, displaying live **Open/Closed Timer Status**.
* **Notice Board:** View batch announcements and schedule adjustments.
* **Certification Hub:** View and download official PDF course completion certificates with unique serial numbers.

---

## 3. Backend REST API Catalog

The backend runs on **`http://localhost:5000/api`**. All endpoints are implemented in [`server.ts`](file:///d:/LMS-Project/lms-backend/server.ts) and backed by MySQL:

| Module | Method | Endpoint | Description |
|---|---|---|---|
| **Auth** | `POST` | `/api/auth/send-otp` | Generates 6-digit OTP code (5 min expiry) |
| **Auth** | `POST` | `/api/auth/verify-otp` | Validates OTP and returns user profile & role |
| **Users** | `GET` | `/api/users` | List all system users |
| **Users** | `POST` | `/api/users` | Create new user (`ADMIN`, `TRAINER`, `STUDENT`) |
| **Students** | `POST` | `/api/students` | Create student profile linked to `user_id` |
| **Students** | `GET` | `/api/students/:id` | Get student profile with joined user details |
| **Trainers** | `POST` | `/api/trainers` | Create trainer profile with specialization |
| **Trainers** | `GET` | `/api/trainers` | List all active trainers |
| **Trainers** | `GET` | `/api/trainers/:id` | Get trainer details |
| **Courses** | `GET` | `/api/courses` | List all active courses |
| **Courses** | `POST` | `/api/courses` | Create new course (e.g. 60 days) |
| **Curriculum** | `GET` | `/api/courses/:id/days` | Get syllabus days for course (Day 1..60) |
| **Curriculum** | `POST` | `/api/courses/:id/days` | Add syllabus day to course |
| **Curriculum** | `GET` | `/api/course-days/:id/content` | Get learning materials for a day |
| **Curriculum** | `POST` | `/api/course-days/:id/content` | Add rich text, video, or attachment to day |
| **Batches** | `GET` | `/api/batches` | List active batches with course & trainer info |
| **Batches** | `POST` | `/api/batches` | Create batch (`course_id`, `trainer_id`, dates) |
| **Batches** | `GET` | `/api/batches/:id` | Get batch by ID |
| **Batches** | `GET` | `/api/batches/:id/students` | Get enrolled students in batch |
| **Batches** | `POST` | `/api/batches/assign-student` | Enroll multiple students into a batch |
| **Live Classes** | `POST` | `/api/live-classes` | Schedule MS Teams live class |
| **Live Classes** | `GET` | `/api/batches/:id/live-classes` | List live classes for a batch |
| **Live Classes** | `PUT` | `/api/live-classes/:id/status` | Update class status (`SCHEDULED`, `COMPLETED`) |
| **Recordings** | `POST` | `/api/live-classes/:id/recordings` | Add recording with **60-day auto retention** |
| **Recordings** | `GET` | `/api/batches/:id/recordings` | Get active non-expired recordings |
| **Attendance** | `POST` | `/api/attendance` | Batch upsert hybrid attendance statuses |
| **Attendance** | `GET` | `/api/batches/:id/attendance` | Get batch attendance sheet (optional `?date=`) |
| **Attendance** | `GET` | `/api/students/:id/attendance` | Student attendance history & percentage |
| **Assignments**| `POST` | `/api/assignments` | Trainer creates day-specific assignment |
| **Assignments**| `GET` | `/api/batches/:id/assignments` | List assignments for batch |
| **Assignments**| `POST` | `/api/assignments/:id/submit` | Student submits assignment file URL |
| **Assignments**| `GET` | `/api/assignments/:id/submissions` | Trainer views assignment submissions |
| **Assignments**| `PUT` | `/api/assignment-submissions/:id/grade`| Grade assignment with marks & feedback |
| **Tests** | `POST` | `/api/tests` | Upload weekly test paper with time window |
| **Tests** | `GET` | `/api/batches/:id/tests` | List tests for batch |
| **Tests** | `POST` | `/api/tests/:id/submit` | Student submits test answer sheet URL |
| **Tests** | `GET` | `/api/tests/:id/submissions` | Trainer views submitted test answer sheets |
| **Tests** | `PUT` | `/api/test-submissions/:id/grade` | Grade test submission |
| **Announcements**| `POST` | `/api/announcements` | Post announcement (with pinned option) |
| **Announcements**| `GET` | `/api/batches/:id/announcements` | Get batch announcements |
| **Chat** | `POST` | `/api/batches/:id/chat-room` | Configure chat room & availability timer |
| **Chat** | `GET` | `/api/batches/:id/chat-room` | Check room status & active timer window |
| **Chat** | `POST` | `/api/chat-rooms/:id/messages` | Send chat message (blocked if timer expired) |
| **Chat** | `GET` | `/api/chat-rooms/:id/messages` | Get batch chat message history |
| **Certificates**| `POST` | `/api/certificates` | Issue certificate & update student status |
| **Certificates**| `GET` | `/api/students/:id/certificates` | Fetch certificates for a student |

---

## 4. Database Schema Summary

The database uses MySQL 8 (`LMS` database) containing 20 normalized tables:

1. `users` — Primary credentials, roles (`ADMIN`, `TRAINER`, `STUDENT`), and active flags.
2. `user_otps` — 6-digit numeric OTP codes, expiration timestamps, and usage tracking.
3. `students` — Extended profile for students, joining date, and certification status.
4. `trainers` — Extended profile for instructors and domain specialization.
5. `courses` — Course metadata, 60-day syllabus duration, description, and images.
6. `batches` — Cohort grouping linking Course + Trainer with scheduled start/end dates.
7. `batch_students` — Enrollment association connecting students to batches.
8. `course_days` — Day 1..60 curriculum days with sequence numbering and topics.
9. `course_contents` — Rich text notes, video URLs, attachments, and publishing flags.
10. `live_classes` — Scheduled live classes, Teams meeting URLs, time windows, and status.
11. `class_recordings` — Video storage references with automatic 60-day retention dates.
12. `attendance` — Hybrid attendance records (`PRESENT_ONLINE`, `PRESENT_OFFLINE`, `ABSENT`, `LEAVE`).
13. `assignments` — Day-specific assignment briefs and due dates.
14. `assignment_submissions` — Student upload URLs, marks awarded, and trainer comments.
15. `tests` — Weekly test papers, subject categorizations, and total marks.
16. `test_submissions` — Student answer sheet URLs and test grades.
17. `announcements` — Broadcast notice board items with pin priorities.
18. `chat_rooms` — Batch chat room states with `active_from` and `active_until` availability timers.
19. `chat_messages` — In-class chat stream messages and sender references.
20. `certificates` — Generated completion credentials, unique certificate numbers, and PDF URLs.

---

## 5. Frontend Design System

The frontend in [`lms-frontend/`](file:///d:/LMS-Project/lms-frontend) is crafted in **Vanilla CSS** without third-party utility frameworks:
* **Dark Luxury Theme:** Sleek background `#090D16` with glassmorphic cards (`backdrop-filter: blur(16px)`).
* **Typography:** Modern `Plus Jakarta Sans` Google Font with high readability.
* **Palette:** Vibrant indigo/violet primary accents (`#6366F1`, `#8B5CF6`) with semantic status indicators (Emerald for Online/Present, Amber for Leave/Warning, Crimson for Absent/Closed).
* **Responsive Layout:** Fixed header with role switcher and collapsible sidebar navigation tailored to each user type.

---

## 6. How to Run Locally

### Prerequisites
* Node.js v18+
* MySQL 8 running locally with `LMS` database (create it from [`database/lms_mysql_schema.sql`](file:///d:/TeamProject/LMS(umaakka)/database/lms_mysql_schema.sql) using MySQL Workbench)

### 1. Start the Backend API Server
```powershell
cd d:\LMS-Project\lms-backend
npm run dev
```
* **URL:** `http://localhost:5000`
* Configuration: Read from `.env` (`PORT=5000`, `DB_HOST=localhost`, `DB_PORT=3306`, `DB_USER=root`, `DB_PASSWORD=...`, `DB_NAME=LMS`)

### 2. Start the Frontend Web Application
```powershell
cd d:\LMS-Project\lms-frontend
npm run dev
```
* **URL:** `http://localhost:5173`
* Browser: Open `http://localhost:5173` to access all portals.

### 3. Run Automated Validation Test Suite
To run the automated smoke test suite that verifies all endpoints against the database:
```powershell
cd d:\LMS-Project\lms-backend
node test-apis.js
```

---

## 7. Phase 2 Roadmap (Future Enhancements)

Features earmarked for Phase 2 as outlined in the Technical Specification:
* **Custom WebRTC Video Classroom:** In-app WebRTC video calling as an alternative to Microsoft Teams.
* **Advanced Chat:** Read receipts, typing indicators, online presence dots, and file attachments in chat.
* **Public Certificate Verification:** QR code scanner and public verification URL (`/verify-certificate/:id`).
* **Push Notifications:** Mobile push notifications and SMS gateway integration.
* **Advanced Analytics:** Batch attendance trend graphs, student retention drop-off analytics, and trainer scorecards.
