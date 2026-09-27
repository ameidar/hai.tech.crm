import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Columns3,
  Edit3,
  List,
  ListTodo,
  Paperclip,
  Plus,
  Send,
  Search,
  Trash2,
  UserRound,
  Upload,
  X,
} from 'lucide-react';
import {
  uploadFileAttachment,
  useCreateTask,
  useDeleteTask,
  useTasks,
  useTaskUsers,
  useUpdateTask,
} from '../hooks/useApi';
import Modal from '../components/ui/Modal';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import SearchableSelect from '../components/ui/SearchableSelect';
import FileAttachments from '../components/FileAttachments';
import type { Task, TaskPriority, TaskStatus } from '../types';

const STATUSES: Array<{ value: TaskStatus; label: string; tone: string }> = [
  { value: 'new', label: 'חדש', tone: 'border-blue-200 bg-blue-50' },
  { value: 'in_progress', label: 'בטיפול', tone: 'border-amber-200 bg-amber-50' },
  { value: 'waiting_info', label: 'ממתין למידע', tone: 'border-purple-200 bg-purple-50' },
  { value: 'completed', label: 'הושלם', tone: 'border-emerald-200 bg-emerald-50' },
];

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'נמוכה',
  normal: 'רגילה',
  high: 'גבוהה',
  urgent: 'דחופה',
};

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  low: 'bg-sky-100 text-sky-700 border-sky-200',
  normal: 'bg-gray-100 text-gray-700 border-gray-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  urgent: 'bg-red-100 text-red-700 border-red-200',
};

const emptyForm = {
  title: '',
  description: '',
  status: 'new' as TaskStatus,
  priority: 'normal' as TaskPriority,
  dueDate: '',
  assigneeId: '',
  completionSummary: '',
  completionDetails: '',
  completionLink: '',
  requiresCompletionLink: false,
};

const emptyCompletionForm = {
  completionSummary: '',
  completionDetails: '',
  completionLink: '',
};

function toDateInput(value?: string | null) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function toApiDate(value: string) {
  if (!value) return null;
  return new Date(`${value}T12:00:00`).toISOString();
}

function isOverdue(task: Task) {
  return !!task.dueDate && task.status !== 'completed' && new Date(task.dueDate) < new Date();
}

const completionLinkPattern = /(ליצור|יצירת|צור|פתח|פתיחת|להקים|הקמת).{0,40}(מחזור|מחזורים|פגישה|פגישות|זום|zoom)|(מחזור|מחזורים|פגישה|פגישות|זום|zoom).{0,40}(חדש|חדשה|יצירה|ליצור|פתיחה|פתח|הקמה|להקים)/i;

function requiresCompletionLink(item: { title?: string | null; description?: string | null; requiresCompletionLink?: boolean | null }) {
  return !!item.requiresCompletionLink || completionLinkPattern.test(`${item.title || ''} ${item.description || ''}`);
}

function newestFirst(a: Task, b: Task) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function formatPendingFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TaskCard({
  task,
  onEdit,
  onDelete,
  onStatus,
  onReassign,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onStatus: (task: Task, status: TaskStatus) => void;
  onReassign: (task: Task) => void;
}) {
  return (
    <article
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/task-id', task.id)}
      className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onEdit(task)}
          className="text-right flex-1 min-w-0"
        >
          <h3 className="font-semibold text-gray-900 leading-6 break-words">{task.title}</h3>
          {task.description && (
            <p className="mt-1 text-sm text-gray-500 line-clamp-2 break-words">{task.description}</p>
          )}
          {task.requiresCompletionLink && task.status !== 'completed' && (
            <p className="mt-2 text-xs font-medium text-amber-700">דורש לינק למחזור/פגישה בסגירה</p>
          )}
        </button>
        <button
          type="button"
          onClick={() => onDelete(task)}
          className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
          title="מחיקה"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${PRIORITY_CLASSES[task.priority]}`}>
          {PRIORITY_LABELS[task.priority]}
        </span>
        {task.dueDate && (
          <span className={`inline-flex items-center gap-1 text-xs ${isOverdue(task) ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
            <CalendarClock size={13} />
            {new Date(task.dueDate).toLocaleDateString('he-IL')}
          </span>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 space-y-3">
        <div className="flex items-center gap-2 min-w-0 text-sm text-gray-700">
          <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-blue-500">
            <UserRound size={15} />
          </div>
          <span className="text-gray-500 shrink-0">נפתח על ידי:</span>
          <span className="font-medium break-words min-w-0">{task.createdBy?.name || '-'}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0 text-sm text-gray-700">
          <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
            <UserRound size={15} />
          </div>
          <span className="text-gray-500 shrink-0">מוקצה ל:</span>
          <span className="font-medium break-words min-w-0">{task.assignee?.name || 'ללא שיוך'}</span>
        </div>
        {task.status === 'completed' && task.completionSummary && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-900">
            <p className="font-semibold">מה נעשה</p>
            <p className="mt-1 break-words">{task.completionSummary}</p>
            {task.completionLink && (
              <a
                href={task.completionLink}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-emerald-700 underline"
              >
                פתיחת לינק
              </a>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => onEdit(task)}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100"
              title="פתח וערוך את המשימה"
            >
              <Edit3 size={14} />
              פתח/ערוך
            </button>
            <button
              type="button"
              onClick={() => onReassign(task)}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
              title="העבר או החזר למשתמש אחר"
            >
              <Send size={14} />
              העבר
            </button>
          </div>
          <button
            type="button"
            onClick={() => onStatus(task, task.status !== 'completed' ? 'completed' : 'in_progress')}
            className={task.status !== 'completed'
              ? 'p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50'
              : 'text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200'}
            title={task.status !== 'completed' ? 'סמן כהושלם' : 'פתח מחדש'}
          >
            {task.status !== 'completed' ? <CheckCircle2 size={18} /> : 'פתח מחדש'}
          </button>
        </div>
      </div>
    </article>
  );
}

export default function Tasks() {
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [assigneeId, setAssigneeId] = useState('');
  const [view, setView] = useState<'board' | 'list'>(() => {
    return (localStorage.getItem('tasks-view') as 'board' | 'list') || 'board';
  });
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [newTaskFiles, setNewTaskFiles] = useState<File[]>([]);
  const [isUploadingNewTaskFiles, setIsUploadingNewTaskFiles] = useState(false);
  const [reassignTask, setReassignTask] = useState<Task | null>(null);
  const [reassignAssigneeId, setReassignAssigneeId] = useState('');
  const [reassignStatus, setReassignStatus] = useState<TaskStatus>('waiting_info');
  const [reassignNote, setReassignNote] = useState('');
  const [reassignError, setReassignError] = useState('');
  const [completionTask, setCompletionTask] = useState<Task | null>(null);
  const [completionForm, setCompletionForm] = useState(emptyCompletionForm);
  const [completionError, setCompletionError] = useState('');

  const { data: tasks = [], isLoading } = useTasks({
    search: search.trim() || undefined,
    priority,
    assigneeId,
  });
  const { data: users = [] } = useTaskUsers();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const userOptions = useMemo(() => users.map((user) => ({
    value: user.id,
    label: user.name,
    sublabel: user.email || user.phone || user.role,
  })), [users]);

  const defaultAssigneeId = useMemo(() => {
    return users.find((user) => /אריאל|ariel/i.test(user.name))?.id || '';
  }, [users]);

  useEffect(() => {
    localStorage.setItem('tasks-view', view);
  }, [view]);

  const tasksByStatus = useMemo(() => {
    return STATUSES.reduce<Record<TaskStatus, Task[]>>((acc, status) => {
      acc[status.value] = tasks
        .filter((task) => task.status === status.value)
        .sort(newestFirst);
      return acc;
    }, {} as Record<TaskStatus, Task[]>);
  }, [tasks]);

  const sortedTasks = useMemo(() => [...tasks].sort(newestFirst), [tasks]);

  const openNew = () => {
    setEditingTask(null);
    setForm({ ...emptyForm, assigneeId: defaultAssigneeId });
    setFormError('');
    setNewTaskFiles([]);
    setIsUploadingNewTaskFiles(false);
    setShowModal(true);
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setForm({
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority,
      dueDate: toDateInput(task.dueDate),
      assigneeId: task.assigneeId || '',
      completionSummary: task.completionSummary || '',
      completionDetails: task.completionDetails || '',
      completionLink: task.completionLink || '',
      requiresCompletionLink: task.requiresCompletionLink ?? requiresCompletionLink(task),
    });
    setFormError('');
    setNewTaskFiles([]);
    setIsUploadingNewTaskFiles(false);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTask(null);
    setFormError('');
    setNewTaskFiles([]);
    setIsUploadingNewTaskFiles(false);
  };

  const addNewTaskFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setNewTaskFiles((current) => [...current, ...Array.from(files)]);
  };

  const removeNewTaskFile = (index: number) => {
    setNewTaskFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const openReassign = (task: Task) => {
    setReassignTask(task);
    setReassignAssigneeId(task.createdById || task.assigneeId || '');
    setReassignStatus(task.status === 'completed' ? 'in_progress' : 'waiting_info');
    setReassignNote('');
    setReassignError('');
  };

  const closeReassign = () => {
    setReassignTask(null);
    setReassignAssigneeId('');
    setReassignStatus('waiting_info');
    setReassignNote('');
    setReassignError('');
  };

  const openCompletion = (task: Task) => {
    setCompletionTask(task);
    setCompletionForm({
      completionSummary: task.completionSummary || '',
      completionDetails: task.completionDetails || '',
      completionLink: task.completionLink || '',
    });
    setCompletionError('');
  };

  const closeCompletion = () => {
    setCompletionTask(null);
    setCompletionForm(emptyCompletionForm);
    setCompletionError('');
  };

  const validateCompletionProof = (
    proof: typeof emptyCompletionForm,
    needsLink: boolean,
  ) => {
    if (!proof.completionSummary.trim()) return 'יש לכתוב מה נעשה לפני השלמת המשימה';
    if (!proof.completionDetails.trim()) return 'יש לכתוב איך זה נעשה לפני השלמת המשימה';
    if (needsLink && !proof.completionLink.trim()) return 'במשימה שדורשת יצירת מחזור או פגישה חובה לצרף לינק';
    return '';
  };

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    if (form.title.trim().length < 2) {
      setFormError('יש להזין כותרת משימה');
      return;
    }
    const requiresLink = requiresCompletionLink({
      title: form.title,
      description: form.description,
      requiresCompletionLink: form.requiresCompletionLink,
    });
    if ((!editingTask || editingTask.status !== 'completed') && form.status === 'completed') {
      const error = validateCompletionProof(form, requiresLink);
      if (error) {
        setFormError(error);
        return;
      }
    }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      priority: form.priority,
      dueDate: toApiDate(form.dueDate),
      assigneeId: form.assigneeId || null,
      requiresCompletionLink: requiresLink,
      completionSummary: form.completionSummary.trim() || null,
      completionDetails: form.completionDetails.trim() || null,
      completionLink: form.completionLink.trim() || null,
    };

    try {
      if (editingTask) {
        await updateTask.mutateAsync({ id: editingTask.id, data: payload });
      } else {
        const createdTask = await createTask.mutateAsync(payload);
        if (newTaskFiles.length > 0) {
          setIsUploadingNewTaskFiles(true);
          try {
            for (const file of newTaskFiles) {
              await uploadFileAttachment('task', createdTask.id, { file });
            }
          } catch (uploadError) {
            setEditingTask(createdTask);
            const message = (uploadError as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
            setFormError(message?.message || message?.error || 'המשימה נוצרה, אבל העלאת אחד הקבצים נכשלה');
            return;
          } finally {
            setIsUploadingNewTaskFiles(false);
          }
        }
      }
      closeModal();
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setFormError(message || 'שמירת המשימה נכשלה');
    }
  };

  const changeStatus = async (task: Task, status: TaskStatus) => {
    if (task.status === status) return;
    if (status === 'completed') {
      openCompletion(task);
      return;
    }
    await updateTask.mutateAsync({ id: task.id, data: { status } });
  };

  const submitCompletion = async (event: FormEvent) => {
    event.preventDefault();
    if (!completionTask) return;
    const needsLink = requiresCompletionLink(completionTask);
    const error = validateCompletionProof(completionForm, needsLink);
    if (error) {
      setCompletionError(error);
      return;
    }
    try {
      await updateTask.mutateAsync({
        id: completionTask.id,
        data: {
          status: 'completed',
          completionSummary: completionForm.completionSummary.trim(),
          completionDetails: completionForm.completionDetails.trim(),
          completionLink: completionForm.completionLink.trim() || null,
          requiresCompletionLink: needsLink,
        },
      });
      closeCompletion();
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setCompletionError(message || 'סימון המשימה כהושלמה נכשל');
    }
  };

  const handleDrop = async (event: DragEvent<HTMLElement>, status: TaskStatus) => {
    event.preventDefault();
    setDragOverStatus(null);
    const id = event.dataTransfer.getData('text/task-id');
    const task = tasks.find((item) => item.id === id);
    if (task) await changeStatus(task, status);
  };

  const handleDelete = async (task: Task) => {
    if (!window.confirm(`למחוק את המשימה "${task.title}"?`)) return;
    await deleteTask.mutateAsync(task.id);
  };

  const submitReassign = async (event: FormEvent) => {
    event.preventDefault();
    if (!reassignTask) return;
    if (!reassignAssigneeId) {
      setReassignError('יש לבחור למי להעביר את המשימה');
      return;
    }
    if (reassignStatus === 'completed') {
      setReassignError('כדי לסמן כהושלם צריך להשתמש בסגירת משימה ולמלא מה נעשה ואיך נעשה');
      return;
    }
    try {
      const trimmedNote = reassignNote.trim();
      const nextDescription = trimmedNote
        ? [
            reassignTask.description?.trim() || '',
            `בקשת מידע (${new Date().toLocaleDateString('he-IL')}): ${trimmedNote}`,
          ].filter(Boolean).join('\n\n')
        : reassignTask.description || null;

      await updateTask.mutateAsync({
        id: reassignTask.id,
        data: {
          assigneeId: reassignAssigneeId,
          status: reassignStatus,
          description: nextDescription,
        },
      });
      closeReassign();
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setReassignError(message || 'העברת המשימה נכשלה');
    }
  };

  const totalOpen = tasks.filter((task) => task.status !== 'completed').length;
  const overdue = tasks.filter(isOverdue).length;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-blue-600 mb-1">
            <ListTodo size={24} />
            <span className="text-sm font-medium">תפעול</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">משימות תפעול</h1>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
        >
          <Plus size={18} />
          משימה חדשה
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500">פתוחות</p>
          <p className="text-2xl font-bold text-gray-900">{totalOpen}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500">באיחור</p>
          <p className="text-2xl font-bold text-red-600">{overdue}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500">סה"כ משימות</p>
          <p className="text-2xl font-bold text-gray-900">{tasks.length}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-col xl:flex-row gap-3 xl:items-center justify-between">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1">
          <label className="relative">
            <Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="חיפוש משימה"
              className="w-full border border-gray-300 rounded-lg pr-9 pl-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </label>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority | '')}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">כל העדיפויות</option>
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">כל המשתמשים</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => setView('board')}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm ${view === 'board' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-600'}`}
          >
            <Columns3 size={16} />
            לוח
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm ${view === 'list' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-600'}`}
          >
            <List size={16} />
            רשימה
          </button>
        </div>
      </div>

      {isLoading ? (
        <Loading text="טוען משימות..." />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ListTodo size={40} />}
          title="אין משימות להצגה"
          description="אפשר ליצור משימה חדשה ולהקצות אותה למשתמש במערכת."
          action={
            <button type="button" onClick={openNew} className="btn btn-primary">
              <Plus size={18} />
              משימה חדשה
            </button>
          }
        />
      ) : view === 'board' ? (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          {STATUSES.map((status) => (
            <section
              key={status.value}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverStatus(status.value);
              }}
              onDragLeave={() => setDragOverStatus(null)}
              onDrop={(event) => handleDrop(event, status.value)}
              className={`border rounded-lg min-h-[360px] ${status.tone} ${dragOverStatus === status.value ? 'ring-2 ring-blue-400' : ''}`}
            >
              <div className="px-4 py-3 border-b border-white/80 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">{status.label}</h2>
                <span className="text-sm bg-white/80 text-gray-600 rounded-full px-2 py-0.5">
                  {tasksByStatus[status.value].length}
                </span>
              </div>
              <div className="p-3 space-y-3">
                {tasksByStatus[status.value].map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onStatus={changeStatus}
                    onReassign={openReassign}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>משימה</th>
                <th>סטטוס</th>
                <th>עדיפות</th>
                <th>נפתח על ידי</th>
                <th>מוקצה</th>
                <th>יעד</th>
                <th className="w-24">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {sortedTasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <button type="button" onClick={() => openEdit(task)} className="text-right">
                      <span className="font-medium text-gray-900">{task.title}</span>
                      {task.description && <p className="text-xs text-gray-500">{task.description}</p>}
                    </button>
                  </td>
                  <td>{STATUSES.find((status) => status.value === task.status)?.label}</td>
                  <td>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs border ${PRIORITY_CLASSES[task.priority]}`}>
                      {PRIORITY_LABELS[task.priority]}
                    </span>
                  </td>
                  <td>{task.createdBy?.name || '-'}</td>
                  <td>{task.assignee?.name || '-'}</td>
                  <td className={isOverdue(task) ? 'text-red-600 font-semibold' : ''}>
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString('he-IL') : '-'}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => openEdit(task)} className="p-1.5 rounded-md hover:bg-gray-100" title="עריכה">
                        <Edit3 size={16} />
                      </button>
                      <button type="button" onClick={() => openReassign(task)} className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50" title="העבר">
                        <Send size={16} />
                      </button>
                      <button type="button" onClick={() => handleDelete(task)} className="p-1.5 rounded-md text-red-600 hover:bg-red-50" title="מחיקה">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingTask ? 'עריכת משימה' : 'משימה חדשה'}
        size="lg"
      >
        <form onSubmit={submitForm} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">כותרת</label>
            <input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">תיאור</label>
            <textarea
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-28"
            />
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={form.requiresCompletionLink}
              onChange={(event) => setForm((prev) => ({ ...prev, requiresCompletionLink: event.target.checked }))}
              className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
            />
            <span>
              <span className="block font-medium">דורש לינק למחזור/פגישה שנוצרו</span>
              <span className="block text-xs text-amber-700">
                אם המשימה כוללת יצירת מחזור, פגישה או Zoom, לא ניתן יהיה לסגור אותה בלי לינק.
              </span>
            </span>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">סטטוס</label>
              <select
                value={form.status}
                onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as TaskStatus }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                {STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">עדיפות</label>
              <select
                value={form.priority}
                onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value as TaskPriority }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">תאריך יעד</label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">מוקצה ל</label>
              <SearchableSelect
                value={form.assigneeId}
                onChange={(value) => setForm((prev) => ({ ...prev, assigneeId: value }))}
                options={userOptions}
                placeholder="ללא שיוך"
                searchPlaceholder="חיפוש משתמש..."
                emptyText="לא נמצאו משתמשים"
              />
            </div>
          </div>

          {form.status === 'completed' && (
            <div className="border-t border-gray-200 pt-4 space-y-3">
              <p className="text-sm font-medium text-gray-700">פירוט השלמה</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">מה נעשה</label>
                <textarea
                  value={form.completionSummary}
                  onChange={(event) => setForm((prev) => ({ ...prev, completionSummary: event.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-20"
                  required={form.status === 'completed'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">איך זה נעשה</label>
                <textarea
                  value={form.completionDetails}
                  onChange={(event) => setForm((prev) => ({ ...prev, completionDetails: event.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-20"
                  required={form.status === 'completed'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  לינק למחזור/פגישה שנוצרו
                </label>
                <input
                  type="url"
                  value={form.completionLink}
                  onChange={(event) => setForm((prev) => ({ ...prev, completionLink: event.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="https://crm.orma-ai.com/..."
                  required={requiresCompletionLink({
                    title: form.title,
                    description: form.description,
                    requiresCompletionLink: form.requiresCompletionLink,
                  })}
                />
              </div>
            </div>
          )}

          {editingTask && (
            <div className="border-t border-gray-200 pt-4">
              <div className="mb-3">
                <p className="text-sm font-medium text-gray-700">קבצים מצורפים</p>
              </div>
              <FileAttachments entityType="task" entityId={editingTask.id} canDelete={true} />
            </div>
          )}

          {!editingTask && (
            <div className="border-t border-gray-200 pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">קבצים מצורפים</label>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center hover:border-blue-300 hover:bg-blue-50">
                <Upload size={24} className="mb-2 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">בחר קבצים לצירוף למשימה</span>
                <span className="mt-1 text-xs text-gray-400">PDF, Word, Excel, תמונות וקבצי עבודה</span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.txt,.rtf,.zip,.rar"
                  onChange={(event) => {
                    addNewTaskFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
              {newTaskFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  {newTaskFiles.map((file, index) => (
                    <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
                      <Paperclip size={15} className="shrink-0 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-800" title={file.name}>{file.name}</p>
                        <p className="text-xs text-gray-400">{formatPendingFileSize(file.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeNewTaskFile(index)}
                        className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        title="הסר קובץ"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
              ביטול
            </button>
            <button
              type="submit"
              disabled={createTask.isPending || updateTask.isPending || isUploadingNewTaskFiles}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {createTask.isPending || updateTask.isPending
                ? 'שומר...'
                : isUploadingNewTaskFiles
                  ? 'מעלה קבצים...'
                  : 'שמירה'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!completionTask}
        onClose={closeCompletion}
        title="סגירת משימה"
        size="md"
      >
        <form onSubmit={submitCompletion} className="p-6 space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">משימה</p>
            <p className="font-semibold text-gray-900">{completionTask?.title}</p>
            {completionTask && requiresCompletionLink(completionTask) && (
              <p className="mt-2 text-xs font-medium text-amber-700">חובה לצרף לינק למחזור/פגישה שנוצרו</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">מה נעשה</label>
            <textarea
              value={completionForm.completionSummary}
              onChange={(event) => setCompletionForm((prev) => ({ ...prev, completionSummary: event.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">איך זה נעשה</label>
            <textarea
              value={completionForm.completionDetails}
              onChange={(event) => setCompletionForm((prev) => ({ ...prev, completionDetails: event.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">לינק למחזור/פגישה שנוצרו</label>
            <input
              type="url"
              value={completionForm.completionLink}
              onChange={(event) => setCompletionForm((prev) => ({ ...prev, completionLink: event.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              placeholder="https://crm.orma-ai.com/..."
              required={!!completionTask && requiresCompletionLink(completionTask)}
            />
          </div>

          {completionError && <p className="text-sm text-red-600">{completionError}</p>}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={closeCompletion} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
              ביטול
            </button>
            <button
              type="submit"
              disabled={updateTask.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 size={16} />
              {updateTask.isPending ? 'סוגר...' : 'סמן כהושלם'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!reassignTask}
        onClose={closeReassign}
        title="העבר משימה"
        size="md"
      >
        <form onSubmit={submitReassign} className="p-6 space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">משימה</p>
            <p className="font-semibold text-gray-900">{reassignTask?.title}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">להעביר אל</label>
            <SearchableSelect
              value={reassignAssigneeId}
              onChange={setReassignAssigneeId}
              options={userOptions}
              placeholder="בחר משתמש"
              searchPlaceholder="חיפוש משתמש..."
              emptyText="לא נמצאו משתמשים"
              allowClear={false}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">סטטוס אחרי העברה</label>
            <select
              value={reassignStatus}
              onChange={(event) => setReassignStatus(event.target.value as TaskStatus)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            >
              {STATUSES.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">מה צריך לברר?</label>
            <textarea
              value={reassignNote}
              onChange={(event) => setReassignNote(event.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24"
              placeholder="לדוגמה: חסר לי מספר טלפון של ההורה / צריך להבין באיזה מחזור מדובר"
            />
            <p className="text-xs text-gray-500 mt-1">
              הטקסט יתווסף לתיאור המשימה לפני ההעברה.
            </p>
          </div>

          {reassignError && <p className="text-sm text-red-600">{reassignError}</p>}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={closeReassign} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
              ביטול
            </button>
            <button
              type="submit"
              disabled={updateTask.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Send size={16} />
              {updateTask.isPending ? 'מעביר...' : 'העבר'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
