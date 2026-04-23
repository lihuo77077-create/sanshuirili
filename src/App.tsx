/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from 'react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths, 
  getYear, 
  getMonth,
  setYear,
  setMonth 
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { 
  Calendar as CalendarIcon, 
  Plus, 
  RefreshCcw, 
  ExternalLink, 
  Sparkles, 
  Loader2, 
  ListTodo, 
  ChevronRight,
  Clock,
  Trash2,
  CheckCircle2,
  Circle,
  Check,
  X,
  Share2,
  Users,
  Copy,
  LogOut,
  Bell
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import { db, handleFirestoreError } from './lib/firebase';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  deleteDoc, 
  query, 
  orderBy,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

type ViewTab = 'today' | 'upcoming' | 'todo';

interface CalendarEvent {
  id: string;
  title: string;
  time: string;
  type: 'calendar' | 'custom';
  date: string; // YYYY-MM-DD
  completed?: boolean;
  createdAt?: string;
  recurrence?: 'daily' | 'weekdays' | 'weekends' | 'none' | 'custom';
  daysOfWeek?: number[]; // 1=Mon, 7=Sun
  priority?: 'P1' | 'P2' | 'P3';
  lastCompletedDate?: string; // YYYY-MM-DD
}

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  priority: 'high' | 'normal' | 'low';
  createdAt?: string;
}

// App component - Main Entry
export default function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('today');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [inputText, setInputText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [showAIInput, setShowAIInput] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTime, setEditTime] = useState('');
  const [showFullCalendar, setShowFullCalendar] = useState(false);
  const [calendarViewDate, setCalendarViewDate] = useState(new Date());
  const [showHistory, setShowHistory] = useState(false);
  const [aiRecurrence, setAiRecurrence] = useState<'none' | 'daily' | 'weekdays' | 'weekends' | 'custom'>('none');
  const [aiDaysOfWeek, setAiDaysOfWeek] = useState<number[]>([]);
  const [aiPriority, setAiPriority] = useState<'P1' | 'P2' | 'P3'>('P3');

  // Reminder System States
  const [activeReminder, setActiveReminder] = useState<{ eventId: string; type: 'notice'; minutes: number } | null>(null);
  const [acknowledgedReminders, setAcknowledgedReminders] = useState<Record<string, number[]>>({});

  // ... (previous static data like holidays remains used via useMemo)

  // China 2026 Statutory Holidays
  const holidays2026 = useMemo(() => ({
    '2026-01-01': { type: 'rest', label: '元旦' },
    '2026-02-17': { type: 'rest', label: '除夕' },
    '2026-02-18': { type: 'rest', label: '春节' },
    '2026-02-19': { type: 'rest', label: '初二' },
    '2026-02-20': { type: 'rest', label: '初三' },
    '2026-02-21': { type: 'rest', label: '初四' },
    '2026-02-22': { type: 'rest', label: '初五' },
    '2026-02-23': { type: 'rest', label: '初六' },
    '2026-02-24': { type: 'rest', label: '初七' },
    '2026-02-15': { type: 'work', label: '班' },
    '2026-03-01': { type: 'work', label: '班' },
    '2026-04-04': { type: 'rest', label: '清明' },
    '2026-04-05': { type: 'rest', label: '清明节' },
    '2026-04-06': { type: 'rest', label: '休' },
    '2026-05-01': { type: 'rest', label: '劳动节' },
    '2026-05-02': { type: 'rest', label: '休' },
    '2026-05-03': { type: 'rest', label: '休' },
    '2026-05-04': { type: 'rest', label: '青年节' },
    '2026-05-05': { type: 'rest', label: '立夏' },
    '2026-06-19': { type: 'rest', label: '端午节' },
    '2026-06-20': { type: 'rest', label: '端午' },
    '2026-06-21': { type: 'rest', label: '休' },
    '2026-09-25': { type: 'rest', label: '中秋节' },
    '2026-09-26': { type: 'rest', label: '中秋' },
    '2026-09-27': { type: 'rest', label: '休' },
    '2026-10-01': { type: 'rest', label: '国庆节' },
    '2026-10-02': { type: 'rest', label: '国庆' },
    '2026-10-03': { type: 'rest', label: '国庆' },
    '2026-10-04': { type: 'rest', label: '休' },
    '2026-10-05': { type: 'rest', label: '休' },
    '2026-10-06': { type: 'rest', label: '休' },
    '2026-10-07': { type: 'rest', label: '休' },
    '2026-10-10': { type: 'work', label: '班' },
  } as Record<string, { type: 'rest' | 'work', label: string }>), []);

  // Shared Calendar State
  const [calendarId, setCalendarId] = useState<string | null>(() => localStorage.getItem('quickcal_shared_id'));
  const [showShareModal, setShowShareModal] = useState(false);
  const [joinId, setJoinId] = useState('');

  const [todos, setTodos] = useState<TodoItem[]>(() => {
    if (localStorage.getItem('quickcal_shared_id')) return [];
    const saved = localStorage.getItem('quickcal_todos');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [events, setEvents] = useState<CalendarEvent[]>(() => {
    if (localStorage.getItem('quickcal_shared_id')) return [];
    const saved = localStorage.getItem('quickcal_events');
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.filter((e: any) => e.id !== '1' && e.id !== '2');
    }
    return [];
  });

  // Pre-calculated filtered data to avoid complex JSX nesting
  const { todayEvents, upcomingEvents } = useMemo(() => {
    const todayStr = format(currentTime, 'yyyy-MM-dd');
    const dayOfWeek = currentTime.getDay();

    const todayList = events.filter(e => {
      const isCompletedToday = e.lastCompletedDate === todayStr;
      if (isCompletedToday) return true;
      if (e.date === todayStr) return true;
      const isPastNonRecurring = !e.completed && e.date < todayStr && (!e.recurrence || e.recurrence === 'none');
      if (isPastNonRecurring) return true;
      
      if (e.recurrence === 'daily') return true;
      if (e.recurrence === 'weekdays' && dayOfWeek >= 1 && dayOfWeek <= 5) return true;
      if (e.recurrence === 'weekends' && (dayOfWeek === 0 || dayOfWeek === 6)) return true;
      const mappedDay = dayOfWeek === 0 ? 7 : dayOfWeek;
      if (e.recurrence === 'custom' && e.daysOfWeek && e.daysOfWeek.includes(mappedDay)) return true;
      return false;
    }).sort((a, b) => {
      // 1. Completion status (Done goes to bottom)
      const isACompleted = a.recurrence && a.recurrence !== 'none' 
        ? a.lastCompletedDate === todayStr 
        : a.completed;
      const isBCompleted = b.recurrence && b.recurrence !== 'none' 
        ? b.lastCompletedDate === todayStr 
        : b.completed;
      
      if (isACompleted !== isBCompleted) {
        return isACompleted ? 1 : -1;
      }

      // 2. Priority
      const pMap = { P1: 0, P2: 1, P3: 2 };
      const pA = pMap[a.priority || 'P3'];
      const pB = pMap[b.priority || 'P3'];
      if (pA !== pB) return pA - pB;
      
      // 3. Date & Time
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.time.localeCompare(b.time);
    });

    const upcomingList = events.filter(e => {
      // For upcoming:
      // 1. Non-recurring: Date must be future
      // 2. Recurring: Should always show a "Next" preview unless it occurred today?
      // Actually, keep it simple for now as per previous logic
      if (e.date > todayStr) return true;
      return false;
    }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

    return { todayEvents: todayList, upcomingEvents: upcomingList };
  }, [events, currentTime]);

  // Priority-grouped events for the overview dashboard
  const groupedTodayEvents = useMemo(() => {
    const groups = { 
      P1: todayEvents.filter(e => e.priority === 'P1'),
      P2: todayEvents.filter(e => e.priority === 'P2'),
      P3: todayEvents.filter(e => e.priority === 'P3' || !e.priority)
    };
    return groups;
  }, [todayEvents]);

  // Firebase Real-time Sync
  useEffect(() => {
    let unsubEvents: (() => void) | null = null;
    let unsubTodos: (() => void) | null = null;

    const setupSubscriptions = () => {
      if (!calendarId) return;

      // Clean up existing if any (for safety)
      unsubEvents?.();
      unsubTodos?.();

      const eventsRef = collection(db, 'shared_calendars', calendarId, 'events');
      const qEvents = query(eventsRef, orderBy('date', 'asc'));
      unsubEvents = onSnapshot(qEvents, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as CalendarEvent[];
        setEvents(data);
      }, (err) => handleFirestoreError(err, 'list', `shared_calendars/${calendarId}/events`));

      const todosRef = collection(db, 'shared_calendars', calendarId, 'todos');
      const qTodos = query(todosRef); 
      unsubTodos = onSnapshot(qTodos, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as TodoItem[];
        setTodos(data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
      }, (err) => handleFirestoreError(err, 'list', `shared_calendars/${calendarId}/todos`));
    };

    if (calendarId) {
      setupSubscriptions();
      
      // Multi-device sync enhancement: Re-connect when app becomes visible
      // This helps mobile devices that might have killed the connection in the background
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          setupSubscriptions();
        }
      };
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        unsubEvents?.();
        unsubTodos?.();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    return () => {
      unsubEvents?.();
      unsubTodos?.();
    };
  }, [calendarId]);

  const toggleSharedMode = async (id: string | null) => {
    if (id) {
      const localEvents = JSON.parse(localStorage.getItem('quickcal_events') || '[]');
      const localTodos = JSON.parse(localStorage.getItem('quickcal_todos') || '[]');
      
      let shouldMigrate = false;
      if (localEvents.length > 0 || localTodos.length > 0) {
        shouldMigrate = window.confirm("发现本地已有数据，是否同步到共享日历？同步后所有人可见。");
      }

      localStorage.setItem('quickcal_shared_id', id);
      setCalendarId(id);
      
      // Initialize room and cloud data if migrating
      try {
        await setDoc(doc(db, 'shared_calendars', id), { createdAt: new Date().toISOString() }, { merge: true });

        if (shouldMigrate) {
          // Migrate Events
          for (const ev of localEvents) {
            await setDoc(doc(db, 'shared_calendars', id, 'events', ev.id), ev);
          }
          // Migrate Todos
          for (const todo of localTodos) {
            await setDoc(doc(db, 'shared_calendars', id, 'todos', todo.id), todo);
          }
          // Clear local storage to avoid confusion if needed, but keeping for backup is safer
        }
      } catch (err) {
        console.error("Initialization error:", err);
        alert("连接云端失败，请检查网络或刷新重试。");
      }
    } else {
      localStorage.removeItem('quickcal_shared_id');
      setCalendarId(null);
      const savedE = localStorage.getItem('quickcal_events');
      setEvents(savedE ? JSON.parse(savedE) : []);
      const savedT = localStorage.getItem('quickcal_todos');
      setTodos(savedT ? JSON.parse(savedT) : []);
    }
  };

  const createSharedCalendar = async () => {
    const newId = Math.random().toString(36).substring(2, 8).toUpperCase();
    await toggleSharedMode(newId);
    setShowShareModal(false);
  };

  const joinSharedCalendar = async () => {
    if (!joinId.trim()) return;
    await toggleSharedMode(joinId.trim().toUpperCase());
    setShowShareModal(false);
    setJoinId('');
  };

  // Derived state for the "Summary Dashboard"
  const stats = useMemo(() => {
    const todayStr = format(currentTime, 'yyyy-MM-dd');
    const dayOfWeek = currentTime.getDay();
    // Show today's events, overdue, PLUS recurring match
    const todayEvents = events.filter(e => {
      if (e.date === todayStr) return true;
      if (!e.completed && e.date < todayStr && (!e.recurrence || e.recurrence === 'none')) return true;
      
      // Recurring logic
      if (e.recurrence === 'daily') return true;
      if (e.recurrence === 'weekdays' && dayOfWeek >= 1 && dayOfWeek <= 5) return true;
      if (e.recurrence === 'weekends' && (dayOfWeek === 0 || dayOfWeek === 6)) return true;
      if (e.recurrence === 'custom' && e.daysOfWeek && e.daysOfWeek.includes(dayOfWeek === 0 ? 7 : dayOfWeek)) return true;
      
      return false;
    });
    const pendingTodos = todos.filter(t => !t.completed);
    
    // Find next upcoming event
    const nextEvent = todayEvents
      .filter(e => !e.completed && e.time > format(currentTime, 'HH:mm'))
      .sort((a, b) => a.time.localeCompare(b.time))[0] || 
      todayEvents.filter(e => !e.completed && e.date < todayStr).sort((a, b) => a.time.localeCompare(b.time))[0];

    return {
      todayCount: todayEvents.length,
      todoCount: pendingTodos.length,
      nextEvent,
      progress: todayEvents.length > 0 
        ? Math.round((todayEvents.filter(e => e.completed).length / todayEvents.length) * 100) 
        : 0
    };
  }, [events, todos, currentTime]);

  const clearAllData = () => {
    if (window.confirm("确定要清空所有日程和待办吗？此操作不可恢复。")) {
      setEvents([]);
      setTodos([]);
      localStorage.removeItem('quickcal_events');
      localStorage.removeItem('quickcal_todos');
    }
  };

  // Auto-Update Current Time & Timer for Reminders
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
      
      const todayStr = format(now, 'yyyy-MM-dd');
      const dayOfWeek = now.getDay();
      const nowHours = now.getHours();
      const nowMinutes = now.getMinutes();

      // Filter events relevant for reminder check - ONLY for P1 (High Priority/Emergency)
      const reminderEvents = events.filter(e => {
        // Only remind for P1 (High Priority) as per user request
        if (e.priority !== 'P1') return false;

        const isCompletedToday = e.lastCompletedDate === todayStr;
        if (e.completed && !isCompletedToday && (!e.recurrence || e.recurrence === 'none')) return false;
        if (isCompletedToday) return false; // Don't remind if already done today
        
        if (e.date === todayStr) return true;
        
        // Handle recurrence
        if (e.recurrence === 'daily') return true;
        if (e.recurrence === 'weekdays' && dayOfWeek >= 1 && dayOfWeek <= 5) return true;
        if (e.recurrence === 'weekends' && (dayOfWeek === 0 || dayOfWeek === 6)) return true;
        const mappedDay = dayOfWeek === 0 ? 7 : dayOfWeek;
        if (e.recurrence === 'custom' && e.daysOfWeek && e.daysOfWeek.includes(mappedDay)) return true;
        
        return false;
      });

      for (const event of reminderEvents) {
        const [eH, eM] = event.time.split(':').map(Number);
        const eventTotalMin = eH * 60 + eM;
        const nowTotalMin = nowHours * 60 + nowMinutes;
        const diff = eventTotalMin - nowTotalMin;

        // Condition for 10 or 5 minute mandatory popups
        if ((diff === 10 || diff === 5) && !acknowledgedReminders[event.id]?.includes(diff)) {
          if (!activeReminder || activeReminder.eventId !== event.id || activeReminder.minutes !== diff) {
            setActiveReminder({ eventId: event.id, type: 'notice', minutes: diff });
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.play().catch(() => {});
          }
        }
        
        // Exact time reminder (0 minutes left) - no mandatory button, auto-closes
        if (diff === 0 && !acknowledgedReminders[event.id]?.includes(0)) {
           if (!activeReminder || activeReminder.eventId !== event.id || activeReminder.minutes !== 0) {
              setActiveReminder({ eventId: event.id, type: 'notice', minutes: 0 });
              const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');
              audio.play().catch(() => {});
              
              // Mark as seen for 0min so it doesn't re-trigger and auto-closes soon
              setAcknowledgedReminders(prev => ({
                ...prev,
                [event.id]: [...(prev[event.id] || []), 0]
              }));
              
              setTimeout(() => setActiveReminder(null), 30000); 
           }
        }
      }
    }, 10000); // Check every 10 seconds for high responsiveness
    return () => clearInterval(timer);
  }, [events, acknowledgedReminders, activeReminder]);

  const theme = {
    primary: calendarId ? 'rose' : 'blue',
    bg: calendarId ? 'bg-rose-500' : 'bg-blue-600',
    text: calendarId ? 'text-rose-500' : 'text-blue-600',
    border: calendarId ? 'border-rose-200' : 'border-blue-200',
    lightBg: calendarId ? 'bg-rose-50' : 'bg-blue-50',
    headerText: calendarId ? 'text-rose-600' : 'text-blue-600',
    progress: calendarId ? 'bg-rose-500' : 'bg-blue-500',
    buttonHover: calendarId ? 'hover:bg-rose-600' : 'hover:bg-blue-700'
  };

  // Persist
  useEffect(() => {
    if (!calendarId) {
      localStorage.setItem('quickcal_todos', JSON.stringify(todos));
    }
  }, [todos, calendarId]);

  useEffect(() => {
    if (!calendarId) {
      localStorage.setItem('quickcal_events', JSON.stringify(events));
    }
  }, [events, calendarId]);

  // Handlers
  const addQuickTodo = async () => {
    if (!inputText.trim()) return;
    const newTodo: TodoItem = {
      id: Date.now().toString(),
      text: inputText,
      completed: false,
      priority: 'normal',
      createdAt: new Date().toISOString()
    };

    if (calendarId) {
      try {
        await setDoc(doc(db, 'shared_calendars', calendarId, 'todos', newTodo.id), newTodo);
      } catch (err) { handleFirestoreError(err, 'create', `shared_calendars/${calendarId}/todos/${newTodo.id}`); }
    } else {
      setTodos(prev => [newTodo, ...prev]);
    }
    setInputText('');
  };

  const toggleTodo = async (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    const newStatus = !todo.completed;

    if (calendarId) {
      try {
        await updateDoc(doc(db, 'shared_calendars', calendarId, 'todos', id), { completed: newStatus });
      } catch (err) { handleFirestoreError(err, 'update', `shared_calendars/${calendarId}/todos/${id}`); }
    } else {
      setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: newStatus } : t));
    }
  };

  const deleteTodo = async (id: string) => {
    if (calendarId) {
      try {
        await deleteDoc(doc(db, 'shared_calendars', calendarId, 'todos', id));
      } catch (err) { handleFirestoreError(err, 'delete', `shared_calendars/${calendarId}/todos/${id}`); }
    } else {
      setTodos(prev => prev.filter(t => t.id !== id));
    }
  };

  const startEditingEvent = (event: CalendarEvent) => {
    setEditingEventId(event.id);
    setEditTitle(event.title);
    setEditTime(event.time);
  };

  const saveEvent = async () => {
    if (!editingEventId) return;
    
    if (calendarId) {
      try {
        await updateDoc(doc(db, 'shared_calendars', calendarId, 'events', editingEventId), { 
          title: editTitle, 
          time: editTime 
        });
      } catch (err) { handleFirestoreError(err, 'update', `shared_calendars/${calendarId}/events/${editingEventId}`); }
    } else {
      setEvents(prev => prev.map(e => e.id === editingEventId ? { ...e, title: editTitle, time: editTime } : e));
    }
    setEditingEventId(null);
  };

  const deleteEvent = async (id: string) => {
    if (calendarId) {
      try {
        await deleteDoc(doc(db, 'shared_calendars', calendarId, 'events', id));
      } catch (err) { handleFirestoreError(err, 'delete', `shared_calendars/${calendarId}/events/${id}`); }
    } else {
      setEvents(prev => prev.filter(e => e.id !== id));
    }
  };

  const toggleEventStatus = async (id: string) => {
    const event = events.find(e => e.id === id);
    if (!event) return;

    const todayStr = format(currentTime, 'yyyy-MM-dd');
    const isRecurring = event.recurrence && event.recurrence !== 'none';
    
    let updatePayload: any;
    if (isRecurring) {
      const completedToday = event.lastCompletedDate === todayStr;
      updatePayload = { 
        lastCompletedDate: completedToday ? '' : todayStr,
        completed: !completedToday 
      };
    } else {
      updatePayload = { completed: !event.completed };
    }

    if (calendarId) {
      try {
        await updateDoc(doc(db, 'shared_calendars', calendarId, 'events', id), updatePayload);
      } catch (err) { handleFirestoreError(err, 'update', `shared_calendars/${calendarId}/events/${id}`); }
    } else {
      setEvents(prev => prev.map(e => e.id === id ? { ...e, ...updatePayload } : e));
    }
  };

  const addEvent = async (result: any) => {
    // Sanitize date to prevent formatting mismatches (YYYY-MM-DD)
    let sanitizedDate = String(result.date).trim().replace(/\//g, '-');
    if (sanitizedDate.length === 8 && /^\d{8}$/.test(sanitizedDate)) {
      sanitizedDate = `${sanitizedDate.substring(0, 4)}-${sanitizedDate.substring(4, 6)}-${sanitizedDate.substring(6, 8)}`;
    }
    
    // Merge AI result with manual recurrence selection if any
    const finalRecurrence = aiRecurrence !== 'none' ? aiRecurrence : (result.recurrence || 'none');
    const finalDaysOfWeek = aiDaysOfWeek.length > 0 ? aiDaysOfWeek : (result.daysOfWeek || []);

    const newEvent: CalendarEvent = {
      id: Date.now().toString() + Math.random().toString(36).substring(7),
      title: result.title,
      time: result.time,
      date: sanitizedDate,
      type: 'custom',
      completed: false,
      createdAt: new Date().toISOString(),
      recurrence: finalRecurrence,
      daysOfWeek: finalDaysOfWeek,
      priority: aiPriority !== 'P3' ? aiPriority : (result.priority || 'P3')
    };

    if (calendarId) {
      try {
        await setDoc(doc(db, 'shared_calendars', calendarId, 'events', newEvent.id), newEvent);
      } catch (err) { handleFirestoreError(err, 'create', `shared_calendars/${calendarId}/events/${newEvent.id}`); }
    } else {
      setEvents(prev => [...prev, newEvent].sort((a, b) => a.time.localeCompare(b.time)));
    }
  };

  const parseAI = async () => {
    if (!inputText.trim()) return;
    
    // Hardcoded fallback for convenience per user request, while retaining secret support
    const zhipuKey = "75535b05c65a40638389028f8d351b74.UIHysx3VdJy42NPe";
    const geminiKey = process.env.GEMINI_API_KEY;
    
    const isZhipu = zhipuKey && zhipuKey.includes('.');
    const isGemini = geminiKey && geminiKey.startsWith('AIzaSy');

    setIsParsing(true);
    try {
      const todayDate = format(currentTime, 'yyyy-MM-dd');
      const nowTime = format(currentTime, 'HH:mm');
      const prompt = `今天日期是 ${todayDate}，当前时间是 ${nowTime} (${format(currentTime, 'EEEE', { locale: zhCN })}). 
      请解析用户输入，识别出提到每一个独立的日程安排，并返回一个 JSON 数组。
      用户输入: "${inputText}"
      
      格式要求：
      返回 JSON 数组，每一项包含: 
      - title: 核心描述。
      - time: 24小时制时间（如 "14:00"）。
        *重要*: 如果用户说"15分钟后"、"一小时后"等相对时间，请基于当前时间 ${nowTime} 准确计算。
        *重要*: 如果未提及时间，请设为 "09:00"。
      - date: 准确计算相对于 ${todayDate} 的日期。
      - recurrence: 如果用户提到"每天"、"每周五"、"工作日"、"周一到周五"等，请设为 "daily"、"weekdays" 或 "weekends"。否则设为 "none"。
      - priority: 如果提及"火速"、"紧急"、"立刻"设为 "P1"；如果提及"重要"、"关键"设为 "P2"；其他设为 "P3"。`;

      let parsedResults = [];

      if (isZhipu) {
        const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${zhipuKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: "glm-4-flash",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
          })
        });
        const data = await response.json();
        const content = data.choices[0].message.content;
        const json = JSON.parse(content);
        // Handle different possible JSON structures from GLM-4
        if (Array.isArray(json)) {
          parsedResults = json;
        } else if (json.events && Array.isArray(json.events)) {
          parsedResults = json.events;
        } else if (json.items && Array.isArray(json.items)) {
          parsedResults = json.items;
        } else {
          // If it's an object with numbered keys or other structure, try to find the array
          const possibleArray = Object.values(json).find(val => Array.isArray(val));
          parsedResults = Array.isArray(possibleArray) ? possibleArray : [];
        }
      } else {
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: { 
                  title: { type: Type.STRING }, 
                  time: { type: Type.STRING },
                  date: { type: Type.STRING, description: "YYYY-MM-DD" }
                },
                required: ["title", "time", "date"]
              }
            }
          }
        });
        const text = response.text;
        parsedResults = JSON.parse(text || '[]');
      }
      if (Array.isArray(parsedResults) && parsedResults.length > 0) {
        for (const res of parsedResults) {
          await addEvent(res);
        }
        setInputText('');
        setAiRecurrence('none');
        setAiDaysOfWeek([]);
        setAiPriority('P3');
        setShowAIInput(false);
      } else {
        throw new Error("No events found");
      }
    } catch (e) {
      alert("AI 解析遇到一点挑战，请尝试缩短输入或检查网络。");
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7] text-[#1C1C1E] safe-area-pt font-sans selection:bg-blue-100 pb-12">
      {/* 顶部交互栏 - iOS 原生简约风格 */}
      <header className="px-6 pt-10 pb-6 flex flex-col gap-1 sticky top-0 bg-[#F2F2F7]/80 backdrop-blur-xl z-20">
        <div className="flex justify-between items-end max-w-4xl mx-auto w-full">
          <div>
            <h2 className={`text-sm font-bold ${theme.headerText} uppercase tracking-widest mb-1 opacity-80`}>
              {format(currentTime, 'EEEE', { locale: zhCN })}
            </h2>
            <h1 className="text-4xl font-black tracking-tighter">
              {format(currentTime, 'M月d日')}
            </h1>
          </div>
          <div className="flex gap-3 mb-1">
            <motion.button 
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowHistory(true)} 
              className="w-12 h-12 rounded-2xl bg-white shadow-sm border border-gray-200 flex items-center justify-center text-gray-600"
            >
              <Clock size={22} />
            </motion.button>
            <motion.button 
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowFullCalendar(true)} 
              className="w-12 h-12 rounded-2xl bg-white shadow-sm border border-gray-200 flex items-center justify-center text-gray-600"
            >
              <CalendarIcon size={22} />
            </motion.button>
            <motion.button 
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowShareModal(true)} 
              className={`w-12 h-12 rounded-2xl shadow-sm border flex items-center justify-center transition-all ${
                calendarId ? `${theme.lightBg} ${theme.border} ${theme.text}` : 'bg-white border-gray-200 text-gray-600'
              }`}
            >
              <Users size={22} />
            </motion.button>
            <motion.button 
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowAIInput(!showAIInput)} 
              className={`w-12 h-12 rounded-2xl shadow-sm border flex items-center justify-center transition-all ${
                showAIInput ? `${theme.bg} border-transparent text-white` : `bg-white border-gray-200 ${theme.text}`
              }`}
            >
              {showAIInput ? <X size={24} /> : <Plus size={24} />}
            </motion.button>
</div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 space-y-8">
        {/* Dashboard 概览区域 - Bento Grid 风格 */}
        {calendarId && (
          <div className={`${theme.lightBg} px-4 py-2 rounded-2xl border ${theme.border} flex items-center justify-between`}>
            <div className="flex items-center gap-2">
              <Users className={`w-4 h-4 ${theme.text}`} />
              <span className={`text-sm font-bold ${calendarId ? 'text-rose-700' : 'text-blue-700'}`}>共享模式激活 (ID: {calendarId})</span>
            </div>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(calendarId);
                alert('共享 ID 已复制！');
              }}
              className={`text-xs font-bold ${theme.text} hover:underline`}
            >
              复制 ID
            </button>
          </div>
        )}

        {/* 今日全景仪表盘 - 现在移到了最前面 */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-7 rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden relative"
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-widest flex items-center gap-2">
              <Sparkles size={16} className="text-amber-500" />
              今日全景看板
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <span className="text-[10px] font-bold text-gray-400">P1</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-[10px] font-bold text-gray-400">P2</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] font-bold text-gray-400">P3</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-red-50/30 p-4 rounded-[1.8rem] space-y-4 border border-red-50/50">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black text-red-500 uppercase tracking-widest">紧急事项</span>
                <span className="ml-auto bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-md font-black">{groupedTodayEvents.P1.length}</span>
              </div>
              <div className="space-y-2">
                {groupedTodayEvents.P1.length > 0 ? groupedTodayEvents.P1.map((e, i) => (
                  <div key={e.id} className="flex gap-2">
                    <span className="text-[10px] font-black text-red-200 mt-0.5">{i + 1}.</span>
                    <p className={`text-[13px] font-bold leading-tight ${e.completed || (e.recurrence && e.lastCompletedDate === format(currentTime, 'yyyy-MM-dd')) ? 'text-red-200 line-through' : 'text-red-700'}`}>
                      {e.title}
                    </p>
                  </div>
                )) : <p className="text-[10px] text-red-300 italic font-medium">✨ 暂无紧急警报</p>}
              </div>
            </div>

            <div className="bg-amber-50/30 p-4 rounded-[1.8rem] space-y-4 border border-amber-50/50">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black text-amber-500 uppercase tracking-widest">重要工作</span>
                <span className="ml-auto bg-amber-500 text-white text-[9px] px-1.5 py-0.5 rounded-md font-black">{groupedTodayEvents.P2.length}</span>
              </div>
              <div className="space-y-2">
                {groupedTodayEvents.P2.length > 0 ? groupedTodayEvents.P2.map((e, i) => (
                  <div key={e.id} className="flex gap-2">
                    <span className="text-[10px] font-black text-amber-200 mt-0.5">{i + 1}.</span>
                    <p className={`text-[13px] font-bold leading-tight ${e.completed || (e.recurrence && e.lastCompletedDate === format(currentTime, 'yyyy-MM-dd')) ? 'text-amber-200 line-through' : 'text-amber-700'}`}>
                      {e.title}
                    </p>
                  </div>
                )) : <p className="text-[10px] text-amber-300 italic font-medium">⚖️ 今日按部就班</p>}
              </div>
            </div>

            <div className="bg-emerald-50/30 p-4 rounded-[1.8rem] space-y-4 border border-emerald-50/50">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black text-emerald-500 uppercase tracking-widest">生活琐事</span>
                <span className="ml-auto bg-emerald-500 text-white text-[9px] px-1.5 py-0.5 rounded-md font-black">{groupedTodayEvents.P3.length}</span>
              </div>
              <div className="space-y-2">
                {groupedTodayEvents.P3.length > 0 ? groupedTodayEvents.P3.map((e, i) => (
                  <div key={e.id} className="flex gap-2">
                    <span className="text-[10px] font-black text-emerald-200 mt-0.5">{i + 1}.</span>
                    <p className={`text-[13px] font-bold leading-tight ${e.completed || (e.recurrence && e.lastCompletedDate === format(currentTime, 'yyyy-MM-dd')) ? 'text-emerald-200 line-through' : 'text-emerald-700'}`}>
                      {e.title}
                    </p>
                  </div>
                )) : <p className="text-[10px] text-emerald-300 italic font-medium">🍃 享受惬意时光</p>}
              </div>
            </div>
          </div>
        </motion.div>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 下一个日程卡片 - 最大的展示卡片 */}
          <div className="md:col-span-2 bg-white rounded-[2.5rem] p-6 shadow-sm border border-gray-100 flex flex-col justify-between min-h-[180px]">
             <div className="flex justify-between items-start">
               <span className={`text-[10px] font-black ${theme.text} uppercase tracking-widest ${theme.lightBg} px-2 py-1 rounded-full`}>下一个安排</span>
               <Clock size={16} className="text-gray-300" />
             </div>
             {stats.nextEvent ? (
               <div className="mt-4">
                 <h3 className="text-2xl font-bold tracking-tight">{stats.nextEvent.title}</h3>
                 <p className="text-gray-400 font-medium mt-1 flex items-center gap-1">
                   还剩 {(() => {
                     const [h, m] = stats.nextEvent.time.split(':').map(Number);
                     const eventTime = new Date();
                     eventTime.setHours(h, m, 0);
                     const diff = Math.max(0, Math.floor((eventTime.getTime() - currentTime.getTime()) / 60000));
                     return diff > 60 ? `${Math.floor(diff/60)}小时${diff%60}分钟` : `${diff}分钟`;
                   })()} 开始
                 </p>
               </div>
             ) : (
               <div className="mt-4">
                 <h3 className="text-xl font-bold text-gray-300">今日已无后续安排</h3>
                 <p className="text-gray-400 text-sm mt-1">点击右上角 + 号添加新目标</p>
               </div>
             )}
             <div className="mt-4 flex items-center gap-2">
                <div className="h-1.5 flex-1 bg-gray-100 rounded-full overflow-hidden">
                   <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${stats.progress}%` }}
                    className={`h-full ${theme.progress}`} 
                   />
                </div>
                <span className="text-[10px] font-bold text-gray-400">{stats.progress}% 进度</span>
             </div>
          </div>

          {/* 状态统计卡片 - 垂直堆叠 */}
          <div className="grid grid-cols-2 md:grid-cols-1 gap-4">
            <div className="bg-white rounded-[2rem] p-5 shadow-sm border border-gray-100 flex items-center gap-4">
              <div className={`w-12 h-12 rounded-2xl ${theme.lightBg} flex items-center justify-center ${theme.text}`}>
                <CalendarIcon size={24} />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">今日日程</p>
                <p className="text-2xl font-black">{stats.todayCount}</p>
              </div>
            </div>
            <div className="bg-white rounded-[2rem] p-5 shadow-sm border border-gray-100 flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500">
                <ListTodo size={24} />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">待办事项</p>
                <p className="text-2xl font-black">{stats.todoCount}</p>
              </div>
            </div>
          </div>
        </section>

        {/* 智能输入框 - 抽屉式设计 */}
        {/* 强提醒遮罩层 */}
        <AnimatePresence>
          {activeReminder && (
            <motion.div 
              initial={{ opacity: 0, y: -50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -50 }}
              className="fixed inset-x-0 top-10 flex justify-center z-[100] pointer-events-none"
            >
              <div className="bg-white/80 backdrop-blur-2xl p-6 rounded-[3rem] shadow-[0_30px_60px_-12px_rgba(0,0,0,0.15)] border border-white/50 w-[90%] max-w-sm pointer-events-auto flex flex-col items-center gap-4">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center ${activeReminder.minutes === 0 ? 'bg-red-500 animate-bounce' : 'bg-amber-500'}`}>
                  <Bell className="text-white" size={32} />
                </div>
                <div className="text-center">
                  <h3 className="text-2xl font-black tracking-tighter">
                    {activeReminder.minutes === 0 ? '准点提醒！' : `还有 ${activeReminder.minutes} 分钟`}
                  </h3>
                  <p className="text-gray-500 font-medium mt-1">
                    {events.find(e => e.id === activeReminder.eventId)?.title || '即将进行的任务'}
                  </p>
                </div>
                {activeReminder.minutes > 0 ? (
                  <motion.button 
                    whileTap={{ scale: 0.9 }}
                    onClick={() => {
                      setAcknowledgedReminders(prev => ({
                        ...prev,
                        [activeReminder.eventId]: [...(prev[activeReminder.eventId] || []), activeReminder.minutes]
                      }));
                      setActiveReminder(null);
                    }}
                    className={`${theme.bg} text-white w-full py-4 rounded-[2rem] font-bold shadow-lg shadow-blue-500/20`}
                  >
                    我知道了
                  </motion.button>
                ) : (
                  <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest animate-pulse">提醒窗口将在30秒后自动关闭</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showAIInput && (
            <motion.div 
              initial={{ opacity: 0, y: -20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.98 }}
              className="bg-white p-6 rounded-[2.5rem] shadow-2xl shadow-blue-900/10 border border-blue-100/50"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Sparkles size={16} className="text-blue-600" />
                </div>
                <h3 className="text-sm font-bold tracking-tight">智能排程助理</h3>
              </div>
              <textarea 
                autoFocus
                placeholder="尝试输入：明天下午三点飞去云南，后天上午十点开会..." 
                className="w-full bg-gray-50/50 p-5 rounded-3xl text-lg font-medium outline-none placeholder:text-gray-300 min-h-[120px] resize-none border border-transparent focus:border-blue-100 transition-all"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
              />

              {/* 周期选择器 */}
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'none', label: '不重复' },
                    { id: 'daily', label: '每天' },
                    { id: 'weekdays', label: '工作日' },
                    { id: 'weekends', label: '周末' },
                    { id: 'custom', label: '自定义' }
                  ].map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setAiRecurrence(opt.id as any);
                        if (opt.id === 'daily') setAiDaysOfWeek([1,2,3,4,5,6,7]);
                        else if (opt.id === 'weekdays') setAiDaysOfWeek([1,2,3,4,5]);
                        else if (opt.id === 'weekends') setAiDaysOfWeek([6,7]);
                        else if (opt.id === 'none') setAiDaysOfWeek([]);
                      }}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                        aiRecurrence === opt.id 
                          ? `${theme.bg} text-white shadow-md` 
                          : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2 justify-between">
                  {[
                    { id: 1, label: '一' },
                    { id: 2, label: '二' },
                    { id: 3, label: '三' },
                    { id: 4, label: '四' },
                    { id: 5, label: '五' },
                    { id: 6, label: '六' },
                    { id: 7, label: '日' }
                  ].map(day => (
                    <button
                      key={day.id}
                      onClick={() => {
                        setAiRecurrence('custom');
                        setAiDaysOfWeek(prev => 
                          prev.includes(day.id) ? prev.filter(d => d !== day.id) : [...prev, day.id]
                        );
                      }}
                      className={`w-10 h-10 rounded-full text-xs font-black transition-all border ${
                        aiDaysOfWeek.includes(day.id)
                          ? `${theme.bg} border-transparent text-white shadow-lg`
                          : 'bg-white border-gray-100 text-gray-300 hover:border-gray-300'
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>

                {/* 优先级选择器 */}
                <div className="flex items-center gap-3 pt-2">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">优先级</span>
                  <div className="flex gap-4">
                    {[
                      { id: 'P1', color: 'bg-red-500', label: '紧急' },
                      { id: 'P2', color: 'bg-amber-500', label: '重要' },
                      { id: 'P3', color: 'bg-emerald-500', label: '普通' }
                    ].map(p => (
                      <button
                        key={p.id}
                        onClick={() => setAiPriority(p.id as any)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all ${
                          aiPriority === p.id 
                            ? `${p.color} text-white shadow-lg` 
                            : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                        }`}
                      >
                        <div className={`w-2 h-2 rounded-full ${aiPriority === p.id ? 'bg-white' : p.color}`} />
                        <span className="text-[10px] font-bold">{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center mt-6 pt-4 border-t border-gray-50">
                <p className="text-xs text-gray-400">我们将自动识别日期和时间</p>
                <motion.button 
                  whileTap={{ scale: 0.95 }}
                  onClick={parseAI}
                  disabled={isParsing || !inputText.trim()}
                  className="bg-blue-600 text-white px-10 py-3.5 rounded-2xl text-sm font-bold flex items-center gap-2 disabled:opacity-30 shadow-lg shadow-blue-500/30"
                >
                  {isParsing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                  一键导入
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 视图切换 - iOS Segmented Control 风格 */}
        <div className="flex justify-center">
          <nav className="inline-flex p-1.5 bg-gray-200/40 rounded-[1.5rem] backdrop-blur-md border border-white/50">
            {(['today', 'upcoming', 'todo'] as ViewTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative px-8 py-2.5 text-xs font-bold rounded-[1.1rem] transition-all duration-300 ${
                  activeTab === tab 
                    ? 'bg-white shadow-sm text-blue-600 px-12' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'today' ? '今日焦点' : tab === 'upcoming' ? '后续安排' : '待办清单'}
              </button>
            ))}
          </nav>
        </div>

        {/* 内容展示区 */}
        <main className="min-h-[400px]">
          <AnimatePresence mode="wait">
            {activeTab === 'today' && (
              <motion.div
                key="today"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-4"
              >
                <div className="grid gap-3">
                  {todayEvents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center p-20 bg-white/40 rounded-[3rem] border border-dashed border-gray-300">
                        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                          <CalendarIcon size={32} className="text-gray-300" />
                        </div>
                        <p className="text-gray-400 font-medium">今天没有任何安排</p>
                        <button onClick={() => setShowAIInput(true)} className={`mt-4 ${theme.text} text-sm font-bold`}>立刻规划日程</button>
                      </div>
                    ) : todayEvents.map(event => {
                      const todayStr = format(currentTime, 'yyyy-MM-dd');
                      const isReallyCompleted = event.recurrence && event.recurrence !== 'none' 
                        ? event.lastCompletedDate === todayStr 
                        : event.completed;

                      return (
                      <motion.div 
                        layout
                        key={event.id}
                        className="bg-white group p-5 rounded-[2.2rem] shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-all active:scale-[0.99] cursor-default"
                        onClick={() => editingEventId === null && startEditingEvent(event)}
                      >
                        <div className="flex items-center gap-5 flex-1">
                          <button 
                            onClick={(e) => { e.stopPropagation(); toggleEventStatus(event.id); }}
                            className={`bg-gray-50 w-11 h-11 rounded-full flex items-center justify-center border border-gray-100 hover:${theme.border} transition-colors`}
                          >
                            {isReallyCompleted ? <CheckCircle2 className={theme.text} size={26} /> : <Circle className="text-gray-200" size={26} />}
                          </button>
                          <div className="flex items-center gap-4">
                            <div className={`w-1 h-10 rounded-full ${
                            isReallyCompleted ? 'bg-gray-200' : 
                            event.priority === 'P1' ? 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse' :
                            event.priority === 'P2' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.3)]' :
                            'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                          }`} />
                            {editingEventId === event.id ? (
                              <div className="flex flex-col gap-2">
                                <input 
                                  autoFocus
                                  className={`bg-transparent text-lg font-bold border-b ${theme.border} outline-none`}
                                  value={editTitle}
                                  onChange={e => setEditTitle(e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                />
                                <input 
                                  className={`bg-transparent text-xs ${theme.text} outline-none`}
                                  value={editTime}
                                  onChange={e => setEditTime(e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                />
                              </div>
                            ) : (
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className={`text-lg font-bold tracking-tight ${event.completed ? 'text-gray-300 line-through' : 'text-gray-800'}`}>
                                    {event.title}
                                  </p>
                                  {event.date < todayStr && !event.completed && (
                                    <span className="px-2 py-0.5 bg-red-50 text-red-500 text-[9px] font-black rounded-full uppercase tracking-tighter">延期</span>
                                  )}
                                </div>
                                <p className="text-xs font-medium flex items-center gap-1 mt-0.5 uppercase tracking-wider">
                                  <Clock size={12} /> 
                                    <span className={(() => {
                                      const [eH, eM] = event.time.split(':').map(Number);
                                      const eventMinutes = eH * 60 + eM;
                                      const nowInMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
                                      const isCompletedTodayLocal = event.recurrence && event.recurrence !== 'none' 
                                        ? event.lastCompletedDate === todayStr 
                                        : event.completed;
                                        
                                      return (eventMinutes < nowInMinutes && !isCompletedTodayLocal && (!event.recurrence || event.recurrence === 'none' || event.date === format(currentTime, 'yyyy-MM-dd'))) 
                                        ? 'text-red-500 font-black animate-pulse' 
                                        : 'text-gray-400';
                                    })()}>
                                    {event.date < todayStr && !event.recurrence ? `原定于 ${format(new Date(event.date), 'M/d')} ` : ''}{event.time}
                                  </span>
                                  {event.recurrence && event.recurrence !== 'none' && (
                                    <span className={`ml-3 px-2 py-0.5 ${theme.lightBg} ${theme.text} text-[10px] font-bold rounded-full flex items-center gap-1 border ${theme.border} shadow-xs`}>
                                      <RefreshCcw size={10} className="opacity-70" />
                                      {event.recurrence === 'daily' ? '每日' : 
                                       event.recurrence === 'weekdays' ? '工作日' : 
                                       event.recurrence === 'weekends' ? '周末' : 
                                       `每周${event.daysOfWeek?.map(d => ['一','二','三','四','五','六','日'][d-1]).join('、')}`}
                                    </span>
                                  )}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                           {editingEventId === event.id ? (
                             <>
                               <button onClick={(e) => { e.stopPropagation(); saveEvent(); }} className={`p-3 ${theme.lightBg} ${theme.text} rounded-2xl`}><Check size={20} /></button>
                               <button onClick={(e) => { e.stopPropagation(); setEditingEventId(null); }} className="p-3 bg-gray-50 text-gray-400 rounded-2xl"><X size={20} /></button>
                             </>
                           ) : (
                             <button 
                                onClick={(e) => { e.stopPropagation(); deleteEvent(event.id); }}
                                className="p-3 text-gray-100 hover:text-red-400 hover:bg-red-50 rounded-2xl transition-all opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={20} />
                              </button>
                           )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {activeTab === 'upcoming' && (
              <motion.div
                key="upcoming"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-8"
              >
                {(() => {
                  const groups: Record<string, CalendarEvent[]> = {};
                  upcomingEvents.forEach(e => {
                    if (!groups[e.date]) groups[e.date] = [];
                    groups[e.date].push(e);
                  });

                  if (upcomingEvents.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center p-20 bg-white/40 rounded-[3rem] border border-dashed border-gray-300">
                        <p className="text-gray-400 font-medium">暂时没有后续日程</p>
                      </div>
                    );
                  }

                  return Object.keys(groups).sort().map(date => (
                    <div key={date} className="space-y-4">
                      <div className="flex items-center gap-4 px-4 text-gray-300">
                        <div className="h-px bg-current flex-1 opacity-20" />
                        <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-gray-400">
                          {date === format(new Date(currentTime.getTime() + 86400000), 'yyyy-MM-dd') ? '明天' : format(new Date(date), 'M月d日 EEEE', { locale: zhCN })}
                        </h4>
                        <div className="h-px bg-current flex-1 opacity-20" />
                      </div>
                      <div className="grid gap-3">
                        {groups[date].map(event => (
                          <div key={event.id} className="bg-white p-5 rounded-[2.2rem] shadow-sm border border-gray-100 flex items-center justify-between group overflow-hidden">
                            <div className="flex items-center gap-5">
                               <div className="w-14 h-14 bg-blue-50 rounded-[1.2rem] flex flex-col items-center justify-center border border-blue-100 text-blue-600">
                                 <span className="text-[10px] uppercase font-bold leading-none mb-1 opacity-60">{format(new Date(event.date), 'M月')}</span>
                                 <span className="text-xl font-black leading-none">{format(new Date(event.date), 'd')}</span>
                               </div>
                               <div>
                                 <p className="text-lg font-bold tracking-tight text-gray-800 leading-tight">{event.title}</p>
                                 <p className="text-xs text-gray-400 font-medium mt-1 uppercase tracking-wider flex items-center gap-1 opacity-80">
                                   <Clock size={12} /> {event.time}
                                 </p>
                               </div>
                            </div>
                            <button 
                              onClick={() => deleteEvent(event.id)}
                              className="p-3 text-gray-100 hover:text-red-400 hover:bg-red-50 rounded-2xl transition-all"
                            >
                              <Trash2 size={20} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </motion.div>
            )}

            {activeTab === 'todo' && (
              <motion.div
                key="todo"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-orange-50 p-6 rounded-[2.5rem] border border-orange-100 flex justify-between items-center">
                    <div>
                      <h3 className="text-xl font-bold text-orange-900 tracking-tight">执行中</h3>
                      <p className="text-orange-600 text-sm font-medium mt-1">{stats.todoCount} 项待完成</p>
                    </div>
                    <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-orange-500 shadow-sm">
                        <ListTodo size={28} />
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 flex flex-col justify-center">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">完成率</p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-gray-100 rounded-full">
                        <motion.div 
                          className="h-full bg-green-500 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${todos.length > 0 ? (todos.filter(t => t.completed).length / todos.length * 100) : 0}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold">{todos.length > 0 ? Math.round((todos.filter(t => t.completed).length / todos.length) * 100) : 0}%</span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3">
                  {todos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-20 bg-white/40 rounded-[3rem] border border-dashed border-gray-300">
                       <ListTodo size={48} className="text-gray-200 mb-4" />
                       <p className="text-gray-400 font-medium">今天可以放松一下，暂无待办</p>
                    </div>
                  ) : (
                    todos.map(todo => (
                      <motion.div 
                        layout
                        key={todo.id} 
                        className="bg-white p-5 rounded-[2.2rem] shadow-sm border border-gray-100 flex items-center justify-between group hover:shadow-md transition-all active:scale-[0.99]"
                      >
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={() => toggleTodo(todo.id)}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all ${
                              todo.completed ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-gray-50 border-gray-100 text-gray-300'
                            }`}
                          >
                            {todo.completed && <Check size={20} />}
                          </button>
                          <span className={`text-lg font-bold tracking-tight ${todo.completed ? 'text-gray-300 line-through' : 'text-gray-700'}`}>
                            {todo.text}
                          </span>
                        </div>
                        <button onClick={() => deleteTodo(todo.id)} className="p-3 text-gray-100 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                          <Trash2 size={22} />
                        </button>
                      </motion.div>
                    ))
                  )}

                  <div className="mt-6 flex gap-3">
                    <input 
                      placeholder="新的任务..."
                      className="flex-1 bg-white px-7 py-4 rounded-[1.8rem] shadow-sm border border-gray-100 outline-none text-lg font-bold placeholder:text-gray-300 focus:border-blue-200 transition-all"
                      value={inputText}
                      onChange={e => setInputText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addQuickTodo()}
                    />
                    <button 
                      onClick={addQuickTodo} 
                      className={`${theme.bg} text-white w-16 h-16 rounded-[1.8rem] flex items-center justify-center shadow-lg ${calendarId ? 'shadow-rose-500/30' : 'shadow-blue-500/30'} active:scale-95 transition-transform`}
                    >
                      <Plus size={36} />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="pt-24 pb-12 text-center flex flex-col items-center gap-8">
          <div className="flex items-center gap-3">
            <div className={`w-1.5 h-1.5 rounded-full ${theme.progress} animate-pulse`} />
            <p className="text-[11px] text-gray-400 font-black uppercase tracking-[0.45em]">QuickCal Edition v2.5</p>
            <div className={`w-1.5 h-1.5 rounded-full ${theme.progress} animate-pulse`} />
          </div>
          <button 
            onClick={clearAllData}
            className="px-10 py-4 bg-white text-red-500 text-[11px] font-black uppercase tracking-widest rounded-full border border-gray-100 shadow-sm hover:bg-red-50 hover:border-red-100 transition-all active:scale-95"
          >
            重置所有应用数据
          </button>
        </footer>

      {/* 日历 Modal - 重新设计 */}
      <AnimatePresence>
        {showFullCalendar && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-md"
            onClick={() => setShowFullCalendar(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 40 }}
              className="bg-white rounded-[3.5rem] shadow-2xl w-full max-w-xl overflow-hidden border border-white/40"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-10">
                <div className="flex items-center justify-between mb-10">
                  <div className="flex items-center gap-4">
                    <h2 className="text-4xl font-black tracking-tighter">
                      {format(calendarViewDate, 'yyyy年 M月')}
                    </h2>
                    <div className="flex bg-gray-100 rounded-[1.5rem] p-1.5">
                      <button onClick={() => setCalendarViewDate(subMonths(calendarViewDate, 1))} className="p-2 hover:bg-white rounded-xl shadow-sm transition-all"><ChevronRight className="rotate-180" size={20} /></button>
                      <button onClick={() => setCalendarViewDate(addMonths(calendarViewDate, 1))} className="p-2 hover:bg-white rounded-xl shadow-sm transition-all"><ChevronRight size={20} /></button>
                    </div>
                  </div>
                  <button onClick={() => setShowFullCalendar(false)} className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-200 transition-colors"><X size={24} /></button>
                </div>

                <div className="grid grid-cols-7 text-center mb-6">
                  {['一', '二', '三', '四', '五', '六', '日'].map((day, i) => (
                    <span key={day} className={`text-[11px] font-black uppercase tracking-[0.2em] ${i >= 5 ? 'text-red-400 opacity-60' : 'text-gray-300'}`}>{day}</span>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1.5">
                  {(() => {
                    const monthStart = startOfMonth(calendarViewDate);
                    const monthEnd = endOfMonth(monthStart);
                    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
                    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
                    
                    return eachDayOfInterval({ start: startDate, end: endDate }).map((day, i) => {
                      const isCurrentMonth = isSameMonth(day, monthStart);
                      const isToday = isSameDay(day, new Date());
                      const dayNum = format(day, 'd');
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const holiday = holidays2026[dateStr as keyof typeof holidays2026];
                      
                      return (
                        <div 
                          key={day.toString()}
                          className={`relative py-5 flex flex-col items-center rounded-[1.3rem] transition-all ${
                            isCurrentMonth ? 'opacity-100' : 'opacity-10'
                          } ${isToday ? `${theme.bg} shadow-2xl ${calendarId ? 'shadow-rose-300' : 'shadow-blue-300'}` : 'hover:bg-gray-50'}`}
                        >
                          <span className={`text-[17px] font-black leading-none ${
                            isToday ? 'text-white' : 
                            (holiday?.type === 'rest' || (i % 7 >= 5 && isCurrentMonth && !holiday)) ? 'text-red-500' : 'text-gray-700'
                          }`}>
                            {dayNum}
                          </span>
                          {holiday && (
                            <span className={`mt-1 text-[9px] font-bold ${isToday ? (calendarId ? 'text-rose-100' : 'text-blue-100') : 'text-gray-400'}`}>
                              {holiday.label}
                            </span>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              <div className="p-4 bg-gray-50 flex justify-center">
                <button 
                   onClick={() => setShowFullCalendar(false)}
                   className="text-xs font-bold text-gray-400 uppercase tracking-widest hover:text-gray-600 transition-colors"
                >
                  点击背景关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
      {/* 历史记录/日志面板 - 时光机 */}
      <AnimatePresence>
        {showHistory && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-6 text-[#1C1C1E]">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="relative w-full max-w-lg bg-white h-[90vh] sm:h-[80vh] rounded-t-[3rem] sm:rounded-[3rem] shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-8 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h3 className="text-xl font-black tracking-tight flex items-center gap-2">
                    <Clock className={theme.text} size={24} /> 历史日志 (30天)
                  </h3>
                  <p className="text-xs text-gray-400 mt-1 font-medium italic">回顾您的每一分努力与坚持</p>
                </div>
                <button onClick={() => setShowHistory(false)} className="w-10 h-10 bg-white shadow-sm rounded-full flex items-center justify-center text-gray-400">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {(() => {
                  const todayStr = format(currentTime, 'yyyy-MM-dd');
                  const historyItems = events
                    .filter(e => e.date < todayStr)
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .slice(0, 50);

                  if (historyItems.length === 0) {
                    return (
                      <div className="py-20 flex flex-col items-center justify-center opacity-30 italic">
                        <Clock size={48} className="mb-4" />
                        <p>尚无历史记录</p>
                      </div>
                    );
                  }

                  const groups: Record<string, CalendarEvent[]> = {};
                  historyItems.forEach(e => {
                    if (!groups[e.date]) groups[e.date] = [];
                    groups[e.date].push(e);
                  });

                  return Object.keys(groups).map(date => (
                    <div key={date} className="space-y-3">
                      <h4 className="text-[10px] font-black text-gray-300 uppercase tracking-widest pl-2">
                        {format(new Date(date), 'M月d日 EEEE', { locale: zhCN })}
                      </h4>
                      <div className="grid gap-2">
                        {groups[date].map(item => (
                          <div key={item.id} className="bg-gray-50/50 p-4 rounded-2xl flex items-center justify-between border border-transparent hover:border-gray-100 transition-all">
                            <div className="flex items-center gap-4 text-left">
                              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${item.completed ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                {item.completed ? <CheckCircle2 size={20} strokeWidth={3} /> : <X size={20} strokeWidth={3} />}
                              </div>
                              <div>
                                <p className={`text-sm font-bold ${item.completed ? 'text-gray-700' : 'text-gray-400'}`}>{item.title}</p>
                                <p className="text-[10px] text-gray-400 font-medium">{item.time}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full ${item.completed ? 'bg-green-50 text-green-500' : 'bg-red-50 text-red-500'}`}>
                                {item.completed ? '已达成' : '未完成'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Share Modal */}
      <AnimatePresence>
        {showShareModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-md relative overflow-hidden"
            >
              <div className={`absolute top-0 left-0 w-full h-2 bg-linear-to-r ${calendarId ? 'from-rose-500 to-pink-600' : 'from-blue-500 to-indigo-600'}`} />
              <button 
                onClick={() => setShowShareModal(false)}
                className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>

              <div className="mb-6">
                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Users className={`w-6 h-6 ${theme.text}`} />
                  共享日历模式
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  开启共享模式，与好友共同编辑同一份日程和待办清单。
                </p>
              </div>

              {calendarId ? (
                <div className="space-y-4">
                  <div className={`p-4 ${theme.lightBg} rounded-2xl border ${theme.border}`}>
                    <p className={`text-xs ${theme.text} font-medium mb-1`}>当前共享 ID</p>
                    <div className="flex items-center justify-between">
                      <span className={`text-2xl font-mono font-bold tracking-widest ${calendarId ? 'text-rose-800' : 'text-blue-800'}`}>{calendarId}</span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(calendarId);
                          alert('ID 已复制！发给朋友在“加入共享”中输入即可。');
                        }}
                        className={`p-2 ${theme.bg} text-white rounded-xl ${theme.buttonHover} transition-colors shadow-sm`}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 text-center">将此 ID 发送给朋友，他们输入后即可看到您的日程。</p>
                  <button 
                    onClick={() => toggleSharedMode(null)}
                    className="w-full py-3 flex items-center justify-center gap-2 text-red-600 font-medium hover:bg-red-50 rounded-2xl transition-colors"
                  >
                    <LogOut className="w-5 h-5" />
                    退出共享模式
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <button 
                      onClick={createSharedCalendar}
                      className={`w-full py-4 bg-linear-to-r ${calendarId ? 'from-rose-600 to-pink-600' : 'from-blue-600 to-indigo-600'} text-white rounded-2xl font-bold shadow-lg ${calendarId ? 'shadow-rose-200' : 'shadow-blue-200'} hover:shadow-xl hover:translate-y-[-2px] transition-all flex items-center justify-center gap-2`}
                    >
                      <Plus className="w-6 h-6" />
                      创建新的共享日历
                    </button>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-gray-100"></span>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-white px-2 text-gray-400">或者加入现有共享</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <input 
                      type="text"
                      placeholder="输入 6 位共享 ID (如: ABCDEF)"
                      value={joinId}
                      onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                      className="w-full px-5 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-blue-500 focus:bg-white outline-hidden transition-all text-center font-mono font-bold tracking-widest text-xl uppercase"
                    />
                    <button 
                      onClick={joinSharedCalendar}
                      disabled={!joinId}
                      className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      进入共享日历
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
