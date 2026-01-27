import { useState, useEffect, useRef } from 'react';

const DAILY_TASKS = [
  { id: 1, label: 'Gym' },
  { id: 2, label: 'Post 1 TikTok' },
  { id: 3, label: 'Send 1 Cold Email/Follow-up' },
  { id: 4, label: 'Journal for 5 Min' },
  { id: 5, label: '15 Min Playing with Claude Code' },
  { id: 6, label: 'Read 10 Pages' },
  { id: 7, label: '10 Min Walk Outside' },
  { id: 8, label: 'Reply to 5 YouTube Comments' },
  { id: 9, label: 'Reply to 5 TikTok Comments' },
  { id: 10, label: 'One Task Toward Digital Product' },
];

const STORAGE_KEY = '75hard-creator-data';

export default function App() {
  const [currentDay, setCurrentDay] = useState(1);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [weeklyTask, setWeeklyTask] = useState('');
  const [weeklyTaskCompleted, setWeeklyTaskCompleted] = useState(false);
  const [lastCompletedDate, setLastCompletedDate] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showResetWarning, setShowResetWarning] = useState(false);
  const [editingWeekly, setEditingWeekly] = useState(false);
  const [tempWeeklyTask, setTempWeeklyTask] = useState('');
  const [history, setHistory] = useState({});
  const [todayPhoto, setTodayPhoto] = useState(null);
  const [todayNotes, setTodayNotes] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedHistoryDay, setSelectedHistoryDay] = useState(null);
  const fileInputRef = useRef(null);

  const today = new Date().toDateString();
  const formattedDate = new Date().toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });

  // Load data on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setCurrentDay(parsed.currentDay || 1);
        setWeeklyTask(parsed.weeklyTask || '');
        setWeeklyTaskCompleted(parsed.weeklyTaskCompleted || false);
        setLastCompletedDate(parsed.lastCompletedDate || null);
        setHistory(parsed.history || {});
        
        if (parsed.lastCompletedDate === today) {
          setCompletedTasks(parsed.completedTasks || []);
          setTodayPhoto(parsed.todayPhoto || null);
          setTodayNotes(parsed.todayNotes || '');
        } else if (parsed.lastCompletedDate) {
          const lastDate = new Date(parsed.lastCompletedDate);
          const todayDate = new Date(today);
          const diffTime = todayDate - lastDate;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          if (diffDays > 1 && parsed.completedTasks?.length < 10) {
            setShowResetWarning(true);
            setCurrentDay(1);
            setCompletedTasks([]);
            setTodayPhoto(null);
            setTodayNotes('');
            setHistory({});
          } else if (diffDays === 1 && parsed.completedTasks?.length === 10) {
            const newHistory = {
              ...parsed.history,
              [parsed.currentDay - 1]: {
                date: parsed.lastCompletedDate,
                tasks: parsed.completedTasks,
                photo: parsed.todayPhoto,
                notes: parsed.todayNotes,
              }
            };
            setHistory(newHistory);
            setCompletedTasks([]);
            setTodayPhoto(null);
            setTodayNotes('');
          } else if (diffDays > 1 && parsed.completedTasks?.length === 10) {
            const newHistory = {
              ...parsed.history,
              [parsed.currentDay - 1]: {
                date: parsed.lastCompletedDate,
                tasks: parsed.completedTasks,
                photo: parsed.todayPhoto,
                notes: parsed.todayNotes,
              }
            };
            setHistory(newHistory);
            setCompletedTasks([]);
            setTodayPhoto(null);
            setTodayNotes('');
          }
        }
      }
    } catch (e) {
      console.log('No saved data found, starting fresh');
    }
    setIsLoading(false);
  }, []);

  // Save data whenever state changes
  useEffect(() => {
    if (isLoading) return;
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        currentDay,
        completedTasks,
        weeklyTask,
        weeklyTaskCompleted,
        lastCompletedDate: completedTasks.length > 0 ? today : lastCompletedDate,
        history,
        todayPhoto,
        todayNotes,
      }));
    } catch (e) {
      console.error('Failed to save:', e);
    }
  }, [currentDay, completedTasks, weeklyTask, weeklyTaskCompleted, history, todayPhoto, todayNotes, isLoading, lastCompletedDate, today]);

  const toggleTask = (taskId) => {
    setCompletedTasks(prev => {
      const isCompleted = prev.includes(taskId);
      const newTasks = isCompleted 
        ? prev.filter(id => id !== taskId)
        : [...prev, taskId];
      
      if (newTasks.length === 10 && !isCompleted) {
        setTimeout(() => {
          setHistory(h => ({
            ...h,
            [currentDay]: {
              date: today,
              tasks: newTasks,
              photo: todayPhoto,
              notes: todayNotes,
            }
          }));
          if (currentDay < 75) {
            setCurrentDay(d => d + 1);
          }
        }, 500);
      }
      
      return newTasks;
    });
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setTodayPhoto(reader.result);
        if (history[currentDay]) {
          setHistory(h => ({
            ...h,
            [currentDay]: {
              ...h[currentDay],
              photo: reader.result,
            }
          }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleNotesChange = (e) => {
    const newNotes = e.target.value;
    setTodayNotes(newNotes);
    if (history[currentDay]) {
      setHistory(h => ({
        ...h,
        [currentDay]: {
          ...h[currentDay],
          notes: newNotes,
        }
      }));
    }
  };

  const resetChallenge = () => {
    if (window.confirm('Are you sure? This will erase all your progress.')) {
      setCurrentDay(1);
      setCompletedTasks([]);
      setWeeklyTask('');
      setWeeklyTaskCompleted(false);
      setShowResetWarning(false);
      setHistory({});
      setTodayPhoto(null);
      setTodayNotes('');
    }
  };

  const saveWeeklyTask = () => {
    setWeeklyTask(tempWeeklyTask);
    setWeeklyTaskCompleted(false);
    setEditingWeekly(false);
  };

  if (isLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Reset Warning Modal */}
      {showResetWarning && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalIcon}>⚠</div>
            <h2 style={styles.modalTitle}>You Missed a Day</h2>
            <p style={styles.modalText}>Back to Day 1. No excuses. Let's go.</p>
            <button style={styles.modalButton} onClick={() => setShowResetWarning(false)}>
              START OVER
            </button>
          </div>
        </div>
      )}

      {/* Calendar Modal */}
      {showCalendar && (
        <div style={styles.modal} onClick={() => setShowCalendar(false)}>
          <div style={styles.calendarModal} onClick={e => e.stopPropagation()}>
            <div style={styles.calendarHeader}>
              <h2 style={styles.calendarTitle}>PROGRESS</h2>
              <button style={styles.closeButton} onClick={() => setShowCalendar(false)}>✕</button>
            </div>
            
            <div style={styles.calendarGrid}>
              {Array.from({ length: 75 }, (_, i) => {
                const dayNum = i + 1;
                const dayData = history[dayNum];
                const isCompleted = dayData?.tasks?.length === 10;
                const isCurrent = dayNum === currentDay;
                const isFuture = dayNum > currentDay;
                
                return (
                  <div
                    key={dayNum}
                    style={{
                      ...styles.calendarDay,
                      ...(isCompleted ? styles.calendarDayCompleted : {}),
                      ...(isCurrent ? styles.calendarDayCurrent : {}),
                      ...(isFuture ? styles.calendarDayFuture : {}),
                    }}
                    onClick={() => {
                      if (dayData) {
                        setSelectedHistoryDay(dayNum);
                        setShowCalendar(false);
                      }
                    }}
                  >
                    {dayNum}
                  </div>
                );
              })}
            </div>
            
            <div style={styles.calendarLegend}>
              <div style={styles.legendItem}>
                <div style={{...styles.legendDot, backgroundColor: '#4ade80'}} />
                <span>Complete</span>
              </div>
              <div style={styles.legendItem}>
                <div style={{...styles.legendDot, border: '2px solid #fff'}} />
                <span>Today</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Day Modal */}
      {selectedHistoryDay && (
        <div style={styles.modal} onClick={() => setSelectedHistoryDay(null)}>
          <div style={styles.historyModal} onClick={e => e.stopPropagation()}>
            <div style={styles.historyHeader}>
              <h2 style={styles.historyTitle}>DAY {selectedHistoryDay}</h2>
              <button style={styles.closeButton} onClick={() => setSelectedHistoryDay(null)}>✕</button>
            </div>
            
            <div style={styles.historyDate}>{history[selectedHistoryDay]?.date}</div>
            
            {history[selectedHistoryDay]?.photo && (
              <img 
                src={history[selectedHistoryDay].photo} 
                alt="Progress" 
                style={styles.historyPhoto}
              />
            )}
            
            {history[selectedHistoryDay]?.notes && (
              <div style={styles.historyNotes}>
                <div style={styles.historyNotesLabel}>NOTES:</div>
                <div style={styles.historyNotesText}>{history[selectedHistoryDay].notes}</div>
              </div>
            )}
            
            <div style={styles.historyTasks}>
              {DAILY_TASKS.map(task => {
                const wasCompleted = history[selectedHistoryDay]?.tasks?.includes(task.id);
                return (
                  <div key={task.id} style={styles.historyTaskRow}>
                    <div style={{
                      ...styles.historyCheck,
                      ...(wasCompleted ? styles.historyCheckDone : {}),
                    }}>
                      {wasCompleted && '✓'}
                    </div>
                    <span style={styles.historyTaskText}>{task.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logoSection}>
          <div style={styles.logo}>
            <span style={styles.logoNumber}>75</span>
            <div style={styles.logoSpade}>♠</div>
          </div>
          <div style={styles.phase}>CREATOR</div>
        </div>
        
        <div style={styles.daySection}>
          <div style={styles.dayLabel}>DAY {currentDay}</div>
          <div style={styles.dateLabel}>{formattedDate}</div>
        </div>
        
        <div style={styles.calendarIcon} onClick={() => setShowCalendar(true)}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
            <rect x="7" y="14" width="3" height="3" fill="white"></rect>
            <rect x="14" y="14" width="3" height="3" fill="white"></rect>
          </svg>
        </div>
      </div>

      {/* Task List */}
      <div style={styles.taskList}>
        {DAILY_TASKS.map((task, index) => {
          const isCompleted = completedTasks.includes(task.id);
          const isPhotoTask = task.id === 1;
          
          return (
            <div key={task.id}>
              <div style={styles.taskRow} onClick={() => toggleTask(task.id)}>
                <div style={{
                  ...styles.checkbox,
                  ...(isCompleted ? styles.checkboxChecked : {}),
                }}>
                  {isCompleted && <span style={styles.checkmark}>✓</span>}
                </div>
                
                <div style={styles.taskContent}>
                  <div style={{
                    ...styles.taskLabel,
                    ...(isCompleted ? styles.taskLabelDone : {}),
                  }}>
                    {task.label}
                  </div>
                </div>
                
                {isPhotoTask && (
                  <div 
                    style={styles.cameraIcon}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current.click();
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                      <circle cx="12" cy="13" r="4"></circle>
                    </svg>
                    {todayPhoto && <div style={styles.photoDot} />}
                  </div>
                )}
              </div>
              {index < DAILY_TASKS.length - 1 && <div style={styles.divider} />}
            </div>
          );
        })}
      </div>
      
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handlePhotoUpload}
        style={{ display: 'none' }}
      />

      {/* Photo Preview */}
      {todayPhoto && (
        <div style={styles.photoPreviewSection}>
          <div style={styles.sectionLabel}>TODAY'S PHOTO:</div>
          <img src={todayPhoto} alt="Today's progress" style={styles.photoPreview} />
        </div>
      )}

      {/* Weekly Task */}
      <div style={styles.weeklySection}>
        <div style={styles.weeklyHeader}>
          <div style={styles.sectionLabel}>WEEKLY TASK:</div>
          <button 
            style={styles.editBtn}
            onClick={() => {
              setTempWeeklyTask(weeklyTask);
              setEditingWeekly(true);
            }}
          >
            {weeklyTask ? 'Edit' : '+ Add'}
          </button>
        </div>
        
        {editingWeekly ? (
          <div style={styles.weeklyEdit}>
            <input
              type="text"
              value={tempWeeklyTask}
              onChange={(e) => setTempWeeklyTask(e.target.value)}
              placeholder="e.g., Call with CEO on Tuesday"
              style={styles.weeklyInput}
              autoFocus
            />
            <div style={styles.weeklyBtns}>
              <button style={styles.cancelBtn} onClick={() => setEditingWeekly(false)}>Cancel</button>
              <button style={styles.saveBtn} onClick={saveWeeklyTask}>Save</button>
            </div>
          </div>
        ) : weeklyTask ? (
          <div style={styles.weeklyTaskRow} onClick={() => setWeeklyTaskCompleted(!weeklyTaskCompleted)}>
            <div style={{
              ...styles.checkbox,
              ...(weeklyTaskCompleted ? styles.checkboxChecked : {}),
            }}>
              {weeklyTaskCompleted && <span style={styles.checkmark}>✓</span>}
            </div>
            <span style={{
              ...styles.taskLabel,
              ...(weeklyTaskCompleted ? styles.taskLabelDone : {}),
            }}>{weeklyTask}</span>
          </div>
        ) : (
          <div style={styles.weeklyPlaceholder}>No weekly task set</div>
        )}
      </div>

      {/* Notes */}
      <div style={styles.notesSection}>
        <div style={styles.sectionLabel}>NOTES:</div>
        <div style={styles.notesDivider} />
        <textarea
          style={styles.notesInput}
          placeholder="Make notes of any challenges, insights, or breakthroughs you achieve."
          value={todayNotes}
          onChange={handleNotesChange}
          rows={3}
        />
      </div>

      {/* Reset */}
      <button style={styles.resetButton} onClick={resetChallenge}>
        Reset Challenge
      </button>

      {/* Completion Toast */}
      {completedTasks.length === 10 && (
        <div style={styles.toast}>
          Day {currentDay - 1} Complete! 🔥
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#000',
    color: '#fff',
    fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
    padding: '20px',
    maxWidth: '480px',
    margin: '0 auto',
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    fontSize: '16px',
    color: '#666',
  },
  
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '30px',
    paddingTop: '10px',
  },
  logoSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  logo: {
    width: '50px',
    height: '50px',
    border: '3px solid #fff',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  logoNumber: {
    fontSize: '20px',
    fontWeight: '800',
    lineHeight: 1,
  },
  logoSpade: {
    fontSize: '14px',
    marginTop: '-2px',
  },
  phase: {
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '1px',
    marginTop: '6px',
    color: '#fff',
  },
  daySection: {
    textAlign: 'center',
    flex: 1,
  },
  dayLabel: {
    fontSize: '36px',
    fontWeight: '800',
    letterSpacing: '2px',
  },
  dateLabel: {
    fontSize: '14px',
    color: '#888',
    marginTop: '2px',
  },
  calendarIcon: {
    cursor: 'pointer',
    padding: '8px',
  },
  
  taskList: {
    marginBottom: '24px',
  },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '18px 0',
    cursor: 'pointer',
  },
  checkbox: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '2px solid #444',
    marginRight: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all 0.2s ease',
  },
  checkboxChecked: {
    backgroundColor: '#4ade80',
    borderColor: '#4ade80',
  },
  checkmark: {
    color: '#000',
    fontSize: '16px',
    fontWeight: '700',
  },
  taskContent: {
    flex: 1,
  },
  taskLabel: {
    fontSize: '17px',
    fontWeight: '500',
    color: '#fff',
  },
  taskLabelDone: {
    color: '#666',
    textDecoration: 'line-through',
  },
  cameraIcon: {
    position: 'relative',
    padding: '8px',
    cursor: 'pointer',
  },
  photoDot: {
    position: 'absolute',
    top: '6px',
    right: '6px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#4ade80',
  },
  divider: {
    height: '1px',
    backgroundColor: '#222',
    marginLeft: '44px',
  },
  
  photoPreviewSection: {
    marginBottom: '24px',
  },
  photoPreview: {
    width: '100%',
    height: '200px',
    objectFit: 'cover',
    borderRadius: '8px',
    marginTop: '8px',
  },
  
  weeklySection: {
    marginBottom: '24px',
    paddingTop: '16px',
    borderTop: '1px solid #222',
  },
  weeklyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  sectionLabel: {
    fontSize: '14px',
    fontWeight: '700',
    letterSpacing: '1px',
    color: '#fff',
  },
  editBtn: {
    background: 'none',
    border: 'none',
    color: '#4ade80',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: '500',
  },
  weeklyTaskRow: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
  },
  weeklyPlaceholder: {
    color: '#444',
    fontSize: '15px',
    fontStyle: 'italic',
  },
  weeklyEdit: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  weeklyInput: {
    backgroundColor: '#111',
    border: '1px solid #333',
    borderRadius: '8px',
    padding: '12px',
    color: '#fff',
    fontSize: '15px',
    outline: 'none',
  },
  weeklyBtns: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#888',
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  saveBtn: {
    backgroundColor: '#4ade80',
    border: 'none',
    color: '#000',
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  
  notesSection: {
    marginBottom: '24px',
  },
  notesDivider: {
    height: '1px',
    backgroundColor: '#444',
    marginTop: '8px',
    marginBottom: '12px',
  },
  notesInput: {
    width: '100%',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#888',
    fontSize: '15px',
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
    lineHeight: '1.5',
    boxSizing: 'border-box',
  },
  
  resetButton: {
    width: '100%',
    background: 'none',
    border: '1px solid #333',
    color: '#666',
    padding: '14px',
    borderRadius: '8px',
    fontSize: '14px',
    cursor: 'pointer',
    marginBottom: '40px',
  },
  
  toast: {
    position: 'fixed',
    bottom: '40px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#4ade80',
    color: '#000',
    padding: '14px 24px',
    borderRadius: '30px',
    fontWeight: '600',
    fontSize: '15px',
    zIndex: 100,
  },
  
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.95)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: '20px',
  },
  modalContent: {
    backgroundColor: '#111',
    padding: '40px',
    borderRadius: '16px',
    textAlign: 'center',
    maxWidth: '320px',
  },
  modalIcon: {
    fontSize: '40px',
    marginBottom: '16px',
  },
  modalTitle: {
    fontSize: '22px',
    fontWeight: '700',
    marginBottom: '8px',
  },
  modalText: {
    color: '#888',
    marginBottom: '24px',
    fontSize: '15px',
  },
  modalButton: {
    backgroundColor: '#fff',
    color: '#000',
    border: 'none',
    padding: '14px 32px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '700',
    letterSpacing: '1px',
    cursor: 'pointer',
  },
  
  calendarModal: {
    backgroundColor: '#111',
    padding: '24px',
    borderRadius: '16px',
    maxWidth: '400px',
    width: '100%',
  },
  calendarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  calendarTitle: {
    fontSize: '18px',
    fontWeight: '700',
    letterSpacing: '2px',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: '24px',
    cursor: 'pointer',
  },
  calendarGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '6px',
    marginBottom: '20px',
  },
  calendarDay: {
    aspectRatio: '1',
    backgroundColor: '#1a1a1a',
    borderRadius: '6px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  calendarDayCompleted: {
    backgroundColor: '#4ade80',
    color: '#000',
  },
  calendarDayCurrent: {
    border: '2px solid #fff',
  },
  calendarDayFuture: {
    backgroundColor: '#0a0a0a',
    color: '#333',
    cursor: 'default',
  },
  calendarLegend: {
    display: 'flex',
    justifyContent: 'center',
    gap: '24px',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#888',
  },
  legendDot: {
    width: '12px',
    height: '12px',
    borderRadius: '3px',
    boxSizing: 'border-box',
  },
  
  historyModal: {
    backgroundColor: '#111',
    padding: '24px',
    borderRadius: '16px',
    maxWidth: '400px',
    width: '100%',
    maxHeight: '80vh',
    overflow: 'auto',
  },
  historyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  historyTitle: {
    fontSize: '24px',
    fontWeight: '800',
    letterSpacing: '2px',
  },
  historyDate: {
    color: '#666',
    fontSize: '14px',
    marginBottom: '16px',
  },
  historyPhoto: {
    width: '100%',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  historyNotes: {
    backgroundColor: '#1a1a1a',
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  historyNotesLabel: {
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '1px',
    marginBottom: '8px',
    color: '#888',
  },
  historyNotesText: {
    color: '#ccc',
    fontSize: '14px',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
  },
  historyTasks: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  historyTaskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  historyCheck: {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    border: '2px solid #333',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: '700',
    color: '#000',
    flexShrink: 0,
  },
  historyCheckDone: {
    backgroundColor: '#4ade80',
    borderColor: '#4ade80',
  },
  historyTaskText: {
    fontSize: '14px',
    color: '#ccc',
  },
};
