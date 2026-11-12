// src/views/student/StudentPortal.tsx
import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import {
  Video, Calendar, FileText, Award, Bell, CheckCircle2, ExternalLink,
  BookOpen, MessageSquare, CheckSquare, Clock, Send, Download
} from 'lucide-react';

export const StudentPortal: React.FC = () => {
  const { user, selectedBatchId } = useAuth();
  const [activeTab, setActiveTab] = useState<'classroom' | 'classes' | 'recordings' | 'attendance' | 'assignments' | 'tests' | 'chat' | 'announcements' | 'certificates'>('classroom');

  const [batchInfo, setBatchInfo] = useState<any>(null);
  const [liveClasses, setLiveClasses] = useState<any[]>([]);
  const [recordings, setRecordings] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [tests, setTests] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);

  // Attendance stats
  const [attendanceData, setAttendanceData] = useState<any>(null);

  // Curriculum Day-wise state (Day 1..60)
  const [courseDays, setCourseDays] = useState<any[]>([]);
  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const [dayContents, setDayContents] = useState<any[]>([]);

  // Chat state
  const [chatRoom, setChatRoom] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [newChatMessage, setNewChatMessage] = useState('');

  const [notice, setNotice] = useState('');

  const batchId = selectedBatchId || user?.batch_id || 2;

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4000);
  };

  const loadBatchData = async () => {
    if (!batchId) return;
    try {
      const [bRes, lcRes, rRes, aRes, tRes, annRes, crRes] = await Promise.all([
        api.getBatchById(batchId),
        api.getLiveClasses(batchId),
        api.getRecordings(batchId),
        api.getAssignments(batchId),
        api.getTests(batchId),
        api.getAnnouncements(batchId),
        api.getChatRoom(batchId),
      ]);

      if (bRes.success && bRes.data) {
        setBatchInfo(bRes.data);
        // Load course days if course_id present
        if (bRes.data.course_id) {
          const daysRes = await api.getCourseDays(bRes.data.course_id);
          if (daysRes.success && daysRes.data) {
            setCourseDays(daysRes.data);
            if (daysRes.data.length > 0) {
              setSelectedDayId(daysRes.data[0].id);
            }
          }
        }
      }

      if (lcRes.success && lcRes.data) setLiveClasses(lcRes.data);
      if (rRes.success && rRes.data) setRecordings(rRes.data);
      if (aRes.success && aRes.data) setAssignments(aRes.data);
      if (tRes.success && tRes.data) setTests(tRes.data);
      if (annRes.success && annRes.data) setAnnouncements(annRes.data);

      if (crRes.success && crRes.data) {
        setChatRoom(crRes.data);
        if (crRes.data.id) {
          const msgRes = await api.getChatMessages(crRes.data.id);
          if (msgRes.success && msgRes.data) setChatMessages(msgRes.data);
        }
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadBatchData();
  }, [batchId]);

  // Load Day Contents
  useEffect(() => {
    if (selectedDayId) {
      api.getDayContent(selectedDayId).then((res) => {
        if (res.success && res.data) setDayContents(res.data);
      });
    }
  }, [selectedDayId]);

  // Load Student Attendance & Certificates
  useEffect(() => {
    const studentId = user?.student_id || 2;
    if (studentId) {
      api.getStudentAttendance(studentId).then((res) => {
        if (res.success) setAttendanceData(res);
      });
      api.getStudentCertificates(studentId).then((res) => {
        if (res.success && res.data) setCertificates(res.data);
      });
    }
  }, [user?.student_id]);

  const handleSubmitAssignment = async (assignmentId: number) => {
    const studentId = user?.student_id || 2;
    const url = window.prompt('Paste your submission file URL (e.g. GitHub repo or Google Drive link):');
    if (!url) return;
    const res = await api.submitAssignment(assignmentId, {
      student_id: studentId,
      submission_file_url: url,
    });
    showNotice(res.success ? 'Assignment submitted successfully!' : (res.message || res.error || 'Submit failed'));
  };

  const handleSubmitTest = async (testId: number) => {
    const studentId = user?.student_id || 2;
    const url = window.prompt('Paste your answer sheet URL:');
    if (!url) return;
    const res = await api.submitTest(testId, {
      student_id: studentId,
      answer_sheet_url: url,
    });
    showNotice(res.success ? 'Test answer sheet submitted successfully!' : (res.message || res.error || 'Submit failed'));
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatRoom?.id || !newChatMessage.trim()) return;
    const res = await api.sendChatMessage(chatRoom.id, {
      sender_user_id: user?.id || user?.user_id || 3,
      message: newChatMessage,
    });
    if (res.success) {
      setNewChatMessage('');
      const msgRes = await api.getChatMessages(chatRoom.id);
      if (msgRes.success && msgRes.data) setChatMessages(msgRes.data);
    } else {
      showNotice(res.message || 'Chat is closed by trainer timer.');
    }
  };

  const tabs = [
    { id: 'classroom' as const, label: 'Day-Wise Classroom (1..60)', icon: <BookOpen size={16} /> },
    { id: 'classes' as const, label: 'Live Classes (Teams)', icon: <Calendar size={16} /> },
    { id: 'recordings' as const, label: '60-Day Recordings', icon: <Video size={16} /> },
    { id: 'attendance' as const, label: 'My Attendance', icon: <CheckSquare size={16} /> },
    { id: 'assignments' as const, label: 'Assignments', icon: <FileText size={16} /> },
    { id: 'tests' as const, label: 'Weekly Tests', icon: <CheckCircle2 size={16} /> },
    { id: 'chat' as const, label: 'Batch Chat', icon: <MessageSquare size={16} /> },
    { id: 'announcements' as const, label: 'Announcements', icon: <Bell size={16} /> },
    { id: 'certificates' as const, label: 'Certificates', icon: <Award size={16} /> },
  ];

  return (
    <div style={{ display: 'flex', flex: 1 }}>
      {/* Sidebar Navigation */}
      <aside style={{
        width: '260px',
        borderRight: '1px solid var(--border-subtle)',
        background: 'rgba(15, 23, 42, 0.4)',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}>
        <div style={{ padding: '0 12px 12px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.05em' }}>
          STUDENT LEARNING PORTAL
        </div>

        {/* Batch Info Card */}
        {batchInfo && (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '12px',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Active Course</div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--primary)' }}>{batchInfo.course_name}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Batch: {batchInfo.batch_code} • Trainer: {batchInfo.trainer_name}
            </div>
          </div>
        )}

        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', width: '100%', fontSize: '0.825rem', padding: '10px 14px' }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </aside>

      {/* Main Learning Hub */}
      <main style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
        {notice && (
          <div style={{
            background: 'var(--success-bg)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#34D399',
            padding: '12px 20px',
            borderRadius: '8px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <CheckCircle2 size={18} /> {notice}
          </div>
        )}

        {/* 1. DAY-WISE CLASSROOM TAB (§ 8) */}
        {activeTab === 'classroom' && (
          <div>
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Day-Wise Learning Classroom (Day 1..60)</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
                Follow your 60-day syllabus step-by-step with lecture notes, videos, and day assignments.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '24px' }}>
              {/* Day Selector */}
              <div className="glass-card" style={{ padding: '16px', maxHeight: '75vh', overflowY: 'auto' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-dim)', marginBottom: '12px' }}>
                  SYLLABUS TIMELINE ({courseDays.length} DAYS)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {courseDays.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDayId(d.id)}
                      className={`btn btn-sm ${selectedDayId === d.id ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '10px 12px' }}
                    >
                      <strong>Day {d.day_number}:</strong> {d.title}
                    </button>
                  ))}
                </div>
              </div>

              {/* Day Study Materials */}
              <div className="glass-card" style={{ padding: '28px' }}>
                {selectedDayId ? (
                  <div>
                    <span className="badge badge-primary" style={{ marginBottom: '8px' }}>
                      Day {courseDays.find((d) => d.id === selectedDayId)?.day_number || 1}
                    </span>
                    <h3 style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '6px' }}>
                      {courseDays.find((d) => d.id === selectedDayId)?.title || 'Day Details'}
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '8px 0 24px' }}>
                      {courseDays.find((d) => d.id === selectedDayId)?.summary || 'Key concepts and day learning plan.'}
                    </p>

                    {dayContents.length === 0 ? (
                      <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dim)' }}>
                        No content uploaded for this day yet.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {dayContents.map((content) => (
                          <div key={content.id} style={{
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '12px',
                            padding: '20px',
                          }}>
                            <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>{content.title}</h4>

                            {content.rich_text_content && (
                              <div style={{
                                margin: '14px 0',
                                fontSize: '0.925rem',
                                lineHeight: '1.6',
                                color: 'var(--text-main)',
                                whiteSpace: 'pre-wrap',
                              }}>
                                {content.rich_text_content}
                              </div>
                            )}

                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
                              {content.video_url && (
                                <a
                                  href={content.video_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-primary btn-sm"
                                >
                                  <Video size={14} /> Watch Day Lecture
                                </a>
                              )}

                              {content.attachment_url && (
                                <a
                                  href={content.attachment_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-secondary btn-sm"
                                >
                                  <Download size={14} /> Download Notes / PDF
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '40px' }}>
                    Select a day from the timeline on the left.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 2. LIVE CLASSES TAB (§ 9) */}
        {activeTab === 'classes' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '24px' }}>
              Scheduled Live Classes (Microsoft Teams)
            </h2>

            {liveClasses.length === 0 ? (
              <div className="glass-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>
                No live classes scheduled currently. Check back later or review recordings!
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
                {liveClasses.map((cls) => (
                  <div key={cls.id} className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <span className={`badge ${cls.status === 'COMPLETED' ? 'badge-success' : 'badge-primary'}`}>
                        {cls.status}
                      </span>
                      <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '10px 0 6px' }}>{cls.class_topic}</h3>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        🕒 {new Date(cls.start_time).toLocaleString()}
                      </div>
                    </div>

                    <a
                      href={cls.teams_meeting_link}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-primary btn-lg"
                      style={{ marginTop: '20px', width: '100%' }}
                    >
                      <ExternalLink size={16} /> Join Teams Live Class
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. 60-DAY RECORDINGS TAB (§ 11 & 12) */}
        {activeTab === 'recordings' && (
          <div>
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Class Recordings (60-Day Retained)</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
                Missed a live session? Stream past class recordings. Each recording is available for 60 days.
              </p>
            </div>

            {recordings.length === 0 ? (
              <div className="glass-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>
                No recordings uploaded for your batch yet.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
                {recordings.map((rec) => (
                  <div key={rec.id} className="glass-card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <span className="badge badge-warning">
                        <Clock size={12} /> 60-Day Window
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        Expires: {new Date(rec.expiry_date).toLocaleDateString()}
                      </span>
                    </div>

                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{rec.class_topic || 'Class Video'}</h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '8px 0 16px' }}>
                      Duration: {rec.duration_minutes || 60} mins
                    </div>

                    <a
                      href={rec.storage_blob_path}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-secondary btn-sm"
                      style={{ width: '100%' }}
                    >
                      <Video size={14} /> Watch Recording
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 4. MY ATTENDANCE TAB (§ 10 & 15) */}
        {activeTab === 'attendance' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '24px' }}>My Attendance Overview (§ 15)</h2>

            {attendanceData && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '32px' }}>
                <div className="glass-card" style={{ padding: '24px' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Attendance Percentage</div>
                  <div style={{
                    fontSize: '2.5rem',
                    fontWeight: 800,
                    color: attendanceData.attendance_percentage >= 75 ? 'var(--success)' : 'var(--danger)',
                    marginTop: '6px',
                  }}>
                    {attendanceData.attendance_percentage}%
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Requirement: 75% for certificate</div>
                </div>

                <div className="glass-card" style={{ padding: '24px' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Present Classes</div>
                  <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--primary)', marginTop: '6px' }}>
                    {attendanceData.present_classes}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Combined Online + Offline</div>
                </div>

                <div className="glass-card" style={{ padding: '24px' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total Conducted Classes</div>
                  <div style={{ fontSize: '2.5rem', fontWeight: 800, marginTop: '6px' }}>
                    {attendanceData.total_classes}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Conducted by Trainer</div>
                </div>
              </div>
            )}

            {/* Attendance History Table */}
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Batch</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceData?.data?.map((att: any) => (
                    <tr key={att.id}>
                      <td>{new Date(att.class_date).toLocaleDateString()}</td>
                      <td>Batch {att.batch_code}</td>
                      <td>
                        <span className={`badge ${
                          att.status.includes('PRESENT') ? 'badge-success' : att.status === 'LEAVE' ? 'badge-warning' : 'badge-danger'
                        }`}>
                          {att.status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 5. ASSIGNMENTS TAB (§ 13) */}
        {activeTab === 'assignments' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '24px' }}>Batch Assignments (§ 13)</h2>
            <div style={{ display: 'grid', gap: '16px' }}>
              {assignments.map((item) => (
                <div key={item.id} className="glass-card" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="badge badge-info" style={{ marginBottom: '8px' }}>Due: {new Date(item.due_date).toLocaleDateString()}</span>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '4px' }}>{item.title}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>{item.description}</p>
                    {item.file_attachment_url && (
                      <a href={item.file_attachment_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--primary)', display: 'inline-block', marginTop: '6px' }}>
                        📎 Download Assignment Brief
                      </a>
                    )}
                  </div>
                  <button className="btn btn-primary" onClick={() => handleSubmitAssignment(item.id)}>
                    Submit Solution
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 6. TESTS TAB (§ 14) */}
        {activeTab === 'tests' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '24px' }}>Weekly Subject Tests (§ 14)</h2>
            <div style={{ display: 'grid', gap: '16px' }}>
              {tests.map((t) => (
                <div key={t.id} className="glass-card" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="badge badge-warning">{t.subject}</span>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '6px 0 4px' }}>{t.title}</h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Total Marks: {t.total_marks}
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={() => handleSubmitTest(t.id)}>
                    Submit Answer Sheet
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 7. BATCH CHAT TAB (§ 16) */}
        {activeTab === 'chat' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Batch Chat Room (§ 16)</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Chat is active only during class availability windows set by the trainer.
                </div>
              </div>

              <span className={`badge ${chatRoom?.is_currently_open === 1 ? 'badge-success' : 'badge-danger'}`}>
                {chatRoom?.is_currently_open === 1 ? '● LIVE / OPEN' : '○ CLOSED BY TIMER'}
              </span>
            </div>

            <div className="glass-card" style={{ height: '550px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {chatMessages.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', textAlign: 'center', margin: 'auto' }}>
                    No messages yet in this batch room.
                  </div>
                ) : (
                  chatMessages.map((m) => (
                    <div key={m.id} style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: m.sender_role === 'TRAINER' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid var(--border-subtle)',
                      maxWidth: '75%',
                      alignSelf: m.sender_user_id === user?.user_id ? 'flex-end' : 'flex-start',
                    }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: m.sender_role === 'TRAINER' ? 'var(--primary)' : 'var(--text-muted)', marginBottom: '4px' }}>
                        {m.sender_name} ({m.sender_role})
                      </div>
                      <div style={{ fontSize: '0.9rem' }}>{m.message}</div>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleSendChatMessage} style={{ padding: '16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '10px' }}>
                <input
                  className="form-input"
                  placeholder={chatRoom?.is_currently_open === 1 ? 'Type your message to trainer & peers...' : 'Chat is closed by the trainer timer.'}
                  value={newChatMessage}
                  onChange={(e) => setNewChatMessage(e.target.value)}
                  disabled={chatRoom?.is_currently_open !== 1}
                />
                <button type="submit" disabled={chatRoom?.is_currently_open !== 1} className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                  <Send size={16} /> Send
                </button>
              </form>
            </div>
          </div>
        )}

        {/* 8. ANNOUNCEMENTS TAB (§ 17) */}
        {activeTab === 'announcements' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '24px' }}>Notice Board & Announcements (§ 17)</h2>
            <div style={{ display: 'grid', gap: '16px' }}>
              {announcements.map((a) => (
                <div key={a.id} className="glass-card" style={{ padding: '20px', borderLeft: a.is_pinned ? '4px solid var(--primary)' : '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{a.title}</h3>
                    {a.is_pinned && <span className="badge badge-primary">PINNED</span>}
                  </div>
                  <p style={{ color: 'var(--text-main)', fontSize: '0.9rem', marginTop: '8px', whiteSpace: 'pre-wrap' }}>
                    {a.content}
                  </p>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '12px' }}>
                    Posted by: {a.author_name} ({a.author_role}) • {new Date(a.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 9. CERTIFICATES TAB (§ 19) */}
        {activeTab === 'certificates' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '24px' }}>Course Completion Certificates (§ 19)</h2>
            {certificates.length === 0 ? (
              <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
                <Award size={48} color="var(--text-dim)" style={{ marginBottom: '12px' }} />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Certificate In Progress</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '6px' }}>
                  Certificate issuance requires completed course work and at least 75% attendance. Once your admin issues it, the PDF will appear here.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {certificates.map((cert) => (
                  <div key={cert.id} className="glass-card" style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span className="badge badge-success">CERTIFIED</span>
                      <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '8px 0 4px' }}>
                        Certificate #{cert.certificate_number}
                      </h3>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Issued on: {new Date(cert.issued_at).toLocaleDateString()}
                      </div>
                    </div>
                    {cert.pdf_url && cert.id && (
                      <a href={api.certificateDownloadUrl(cert.id)} className="btn btn-primary">
                        <Download size={16} /> Download Certificate PDF
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
