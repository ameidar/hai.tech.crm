import type { ReactNode } from 'react';
import { 
  InboxIcon, 
  Users, 
  GraduationCap, 
  Building2, 
  RefreshCcw, 
  UserCheck,
  BookOpen,
  Calendar,
  FileText
} from 'lucide-react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: 'default' | 'compact' | 'card';
}

// Decorative background pattern component
function DecorativePattern() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
      <div className="absolute -top-4 -right-4 w-24 h-24 bg-blue-100 rounded-full blur-xl" />
      <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-purple-100 rounded-full blur-xl" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-gradient-to-br from-blue-50 to-purple-50 rounded-full blur-2xl" />
    </div>
  );
}

// Icon wrapper with nice styling
function IconWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      {/* Animated ring */}
      <div className="absolute inset-0 animate-ping opacity-20">
        <div className="w-full h-full rounded-full bg-blue-400" />
      </div>
      {/* Main icon container */}
      <div className="relative w-24 h-24 bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl flex items-center justify-center shadow-sm border border-blue-100/50">
        <div className="text-blue-500">
          {children}
        </div>
      </div>
      {/* Decorative dots */}
      <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-200 rounded-full" />
      <div className="absolute -bottom-2 -left-2 w-4 h-4 bg-purple-200 rounded-full" />
    </div>
  );
}

export default function EmptyState({ icon, title, description, action, variant = 'default' }: EmptyStateProps) {
  if (variant === 'compact') {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <div className="text-gray-300 mb-3">
          {icon || <InboxIcon size={40} />}
        </div>
        <h3 className="text-base font-medium text-gray-700 mb-1">{title}</h3>
        {description && <p className="text-gray-400 text-sm max-w-xs">{description}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center max-w-md mx-auto">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400">
            {icon || <InboxIcon size={32} />}
          </div>
        </div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">{title}</h3>
        {description && <p className="text-gray-500 text-sm mb-6">{description}</p>}
        {action}
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center py-20 px-4 text-center">
      <DecorativePattern />
      
      <div className="relative z-10">
        <div className="flex justify-center mb-6">
          <IconWrapper>
            {icon || <InboxIcon size={40} />}
          </IconWrapper>
        </div>
        
        <h3 className="text-xl font-semibold text-gray-800 mb-3">{title}</h3>
        
        {description && (
          <p className="text-gray-500 mb-8 max-w-sm leading-relaxed">{description}</p>
        )}
        
        {action && (
          <div className="relative">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

// Specialized empty states with custom illustrations
export function CustomersEmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={<Users size={40} />}
      title="אין לקוחות עדיין"
      description="התחל להוסיף לקוחות למערכת כדי לנהל את המידע שלהם"
      action={
        onAdd && (
          <button onClick={onAdd} className="btn btn-primary">
            הוסף לקוח ראשון
          </button>
        )
      }
    />
  );
}

export function StudentsEmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={<GraduationCap size={40} />}
      title="לא נמצאו תלמידים"
      description="תלמידים מתווספים דרך דף הלקוחות"
      action={
        onAdd && (
          <button onClick={onAdd} className="btn btn-primary">
            עבור ללקוחות
          </button>
        )
      }
    />
  );
}

export function CyclesEmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={<RefreshCcw size={40} />}
      title="אין מחזורים"
      description="צור מחזור חדש כדי להתחיל לנהל את הפעילויות"
      action={
        onAdd && (
          <button onClick={onAdd} className="btn btn-primary">
            צור מחזור ראשון
          </button>
        )
      }
    />
  );
}

export function BranchesEmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={<Building2 size={40} />}
      title="אין סניפים"
      description="הוסף סניפים כדי לארגן את הפעילויות לפי מיקום"
      action={
        onAdd && (
          <button onClick={onAdd} className="btn btn-primary">
            הוסף סניף ראשון
          </button>
        )
      }
    />
  );
}

export function InstructorsEmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={<UserCheck size={40} />}
      title="אין מדריכים"
      description="הוסף מדריכים כדי לשייך אותם למחזורים"
      action={
        onAdd && (
          <button onClick={onAdd} className="btn btn-primary">
            הוסף מדריך ראשון
          </button>
        )
      }
    />
  );
}

export function NoResultsEmptyState({ query }: { query?: string }) {
  return (
    <EmptyState
      icon={<InboxIcon size={40} />}
      title="לא נמצאו תוצאות"
      description={query ? `לא נמצאו תוצאות עבור "${query}"` : 'נסה לשנות את מונחי החיפוש'}
      variant="compact"
    />
  );
}
