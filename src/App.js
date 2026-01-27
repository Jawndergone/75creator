import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

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
  // Auth state
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // App state
  const [currentDay, setCurrentDay] = useState(1);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [weeklyTask, setWeeklyTask] = useState('');
  const [weeklyTaskCompleted, setWeeklyTaskCompleted] = useState(false);
  const [lastCompletedDate, setLastCompletedDate] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showResetWarning, setShowResetWarning] = useState(false);
  const [showIncompleteWarning, setShowIncompleteWarning] = useState(false);
  const [editingWeekly, setEditingWeekly] = useState(false);
  const [tempWeeklyTask, setTempWeeklyTask] = useState('');
  const [history, setHistory] = useState({});
  const [todayPhoto, setTodayPhoto] = useState(null);
  const [todayNotes, setTodayNotes] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedHistoryDay, setSelectedHistoryDay] = useState(null);
  const fileInputRef = useRef(null);
  const midnightCheckRef = useRef(null);

  const today = new Date().toDateString();
  const formattedDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  // Check auth state on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load data when user logs in
  useEffect(() => {
    if (user) {
      loadUserProgress();
    } else {
      setIsLoading(false);
    }
  }, [user]);

  // Set up midnight check
  useEffect(() => {
    if (!user) return;

    const checkMidnight = () => {
      const now = new Date();
      const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0) - now;

      midnightCheckRef.current = setTimeout(() => {
        // It's midnight - check if tasks were completed
        if (completedTasks.length < 10 && completedTasks.length > 0) {
          setShowIncompleteWarning(true);
        }
        // Set up next midnight check
        checkMidnight();
      }, msUntilMidnight);
    };

    checkMidnight();

    return () => {
      if (midnightCheckRef.current) {
        clearTimeout(midnightCheckRef.current);
      }
    };
  }, [user, completedTasks]);

  const loadUserProgress = async () => {
    try {
      const { data, error } = await supabase
        .from('user_progress')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading progress:', error);
        return;
      }

      if (data) {
        setCurrentDay(data.current_day || 1);
        setWeeklyTask(data.weekly_task || '');
        setWeeklyTaskCompleted(data.weekly_task_completed || false);
        setLastCompletedDate(data.last_completed_date || null);
        setHistory(data.history || {});

        // Check if it's a new day
        if (data.last_completed_date === today) {
          setCompletedTasks(data.completed_tasks || []);
          setTodayPhoto(data.today_photo || null);
          setTodayNotes(data.today_notes || '');
        } else if (data.last_completed_date) {
          const lastDate = new Date(data.last_completed_date);
          const todayDate = new Date(today);
          const diffTime = todayDate - lastDate;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          // Yesterday wasn't complete - show incomplete warning
          if (diffDays >= 1 && data.completed_tasks?.length > 0 && data.completed_tasks?.length < 10) {
            setShowIncompleteWarning(true);
          }
          // Missed more than 1 day without completing
          else if (diffDays > 1 && data.completed_tasks?.length < 10) {
            setShowResetWarning(true);
            setCurrentDay(1);
            setCompletedTasks([]);
            setTodayPhoto(null);
            setTodayNotes('');
            setHistory({});
          }
          // Completed yesterday, start fresh today
          else if (data.completed_tasks?.length === 10) {
            const newHistory = {
              ...data.history,
              [data.current_day]: {
                date: data.last_completed_date,
                tasks: data.completed_tasks,
                photo: data.today_photo,
                notes: data.today_notes,
              }
            };
            setHistory(newHistory);
            setCompletedTasks([]);
            setTodayPhoto(null);
            setTodayNotes('');
            if (data.current_day < 75) {
              setCurrentDay(data.current_day + 1);
            }
          }
        }
      } else {
        // New user - create initial progress record
        await supabase.from('user_progress').insert({
          user_id: user.id,
          current_day: 1,
          completed_tasks: [],
          weekly_task: '',
          weekly_task_completed: false,
          history: {},
          today_notes: '',
        });
      }
    } catch (e) {
      console.error('Failed to load progress:', e);
    }
    setIsLoading(false);
  };

  // Save to Supabase whenever state changes
  useEffect(() => {
    if (isLoading || !user) return;

    const saveProgress = async () => {
      try {
        await supabase
          .from('user_progress')
          .update({
            current_day: currentDay,
            completed_tasks: completedTasks,
            weekly_task: weeklyTask,
            weekly_task_completed: weeklyTaskCompleted,
            last_completed_date: completedTasks.length > 0 ? today : lastCompletedDate,
            history: history,
            today_photo: todayPhoto,
            today_notes: todayNotes,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id);
      } catch (e) {
        console.error('Failed to save:', e);
      }
    };

    const debounce = setTimeout(saveProgress, 500);
    return () => clearTimeout(debounce);
  }, [currentDay, completedTasks, weeklyTask, weeklyTaskCompleted, history, todayPhoto, todayNotes, isLoading, user, lastCompletedDate, today]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');

    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setAuthError('Check your email for a confirmation link!');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) setAuthError(error.message);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setCurrentDay(1);
    setCompletedTasks([]);
    setWeeklyTask('');
    setWeeklyTaskCompleted(false);
    setHistory({});
    setTodayPhoto(null);
    setTodayNotes('');
  };

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

  const resetChallenge = async () => {
    setCurrentDay(1);
    setCompletedTasks([]);
    setWeeklyTask('');
    setWeeklyTaskCompleted(false);
    setShowResetWarning(false);
    setShowIncompleteWarning(false);
    setHistory({});
    setTodayPhoto(null);
    setTodayNotes('');
    setLastCompletedDate(null);
  };

  const continueAnyway = () => {
    setShowIncompleteWarning(false);
    // Reset today's tasks but keep the day count
    setCompletedTasks([]);
    setTodayPhoto(null);
    setTodayNotes('');
  };

  const saveWeeklyTask = () => {
    setWeeklyTask(tempWeeklyTask);
    setWeeklyTaskCompleted(false);
    setEditingWeekly(false);
  };

  // Auth loading screen
  if (authLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  // Login/Signup screen
  if (!user) {
    return (
      <div style={styles.container}>
        <div style={styles.authContainer}>
          <div style={styles.logo}>
            <span style={styles.logoNumber}>75</span>
            <div style={styles.logoSpade}>♠</div>
          </div>
          <div style={styles.phase}>CREATOR</div>

          <h2 style={styles.authTitle}>
            {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
          </h2>

          <form onSubmit={handleAuth} style={styles.authForm}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.authInput}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.authInput}
              required
              minLength={6}
            />

            {authError && (
              <div style={styles.authError}>{authError}</div>
            )}

            <button type="submit" style={styles.authButton}>
              {authMode === 'login' ? 'LOG IN' : 'SIGN UP'}
            </button>
          </form>

          <div style={styles.dividerContainer}>
            <div style={styles.dividerLine} />
            <span style={styles.dividerText}>or</span>
            <div style={styles.dividerLine} />
          </div>

          <button style={styles.googleButton} onClick={handleGoogleSignIn}>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <button
            style={styles.authSwitch}
            onClick={() => {
              setAuthMode(authMode === 'login' ? 'signup' : 'login');
              setAuthError('');
            }}
          >
            {authMode === 'login'
              ? "Don't have an account? Sign up"
              : "Already have an account? Log in"}
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading your progress...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Reset Warning Modal - Missed a day */}
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

      {/* Incomplete Tasks Warning Modal */}
      {showIncompleteWarning && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <div style={styles.modalIcon}>😤</div>
            <h2 style={styles.modalTitle}>You Didn't Finish</h2>
            <p style={styles.modalText}>
              You only completed {completedTasks.length}/10 tasks.
              In 75 Hard, that means starting over. Your call.
            </p>
            <button style={styles.modalButton} onClick={resetChallenge}>
              START OVER
            </button>
            <button style={styles.modalButtonSecondary} onClick={continueAnyway}>
              Continue Anyway
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

      {/* Reset & Sign Out */}
      <button style={styles.resetButton} onClick={resetChallenge}>
        Reset Challenge
      </button>

      <button style={styles.signOutButton} onClick={handleSignOut}>
        Sign Out
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

  // Auth styles
  authContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '80vh',
    padding: '20px',
  },
  authTitle: {
    fontSize: '24px',
    fontWeight: '600',
    marginTop: '30px',
    marginBottom: '24px',
  },
  authForm: {
    width: '100%',
    maxWidth: '300px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  authInput: {
    backgroundColor: '#111',
    border: '1px solid #333',
    borderRadius: '8px',
    padding: '14px 16px',
    color: '#fff',
    fontSize: '16px',
    outline: 'none',
  },
  authButton: {
    backgroundColor: '#fff',
    color: '#000',
    border: 'none',
    padding: '14px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '700',
    letterSpacing: '1px',
    cursor: 'pointer',
    marginTop: '8px',
  },
  authSwitch: {
    background: 'none',
    border: 'none',
    color: '#4ade80',
    fontSize: '14px',
    marginTop: '20px',
    cursor: 'pointer',
  },
  dividerContainer: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    maxWidth: '300px',
    margin: '20px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    backgroundColor: '#333',
  },
  dividerText: {
    color: '#666',
    padding: '0 12px',
    fontSize: '14px',
  },
  googleButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    width: '100%',
    maxWidth: '300px',
    backgroundColor: '#fff',
    color: '#000',
    border: 'none',
    padding: '14px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  authError: {
    color: '#f87171',
    fontSize: '14px',
    textAlign: 'center',
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
    marginBottom: '12px',
  },

  signOutButton: {
    width: '100%',
    background: 'none',
    border: 'none',
    color: '#666',
    padding: '14px',
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
    lineHeight: '1.5',
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
    width: '100%',
    marginBottom: '12px',
  },
  modalButtonSecondary: {
    backgroundColor: 'transparent',
    color: '#666',
    border: '1px solid #333',
    padding: '14px 32px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    width: '100%',
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
