import { Loader2 } from 'lucide-react';

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

export default function Loading({ size = 'md', text }: LoadingProps) {
  const sizes = {
    sm: 16,
    md: 24,
    lg: 32,
  };

  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8">
      <Loader2 size={sizes[size]} className="animate-spin text-blue-600" />
      {text && <p className="text-gray-500 text-sm">{text}</p>}
    </div>
  );
}

export function PageLoading() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loading size="lg" text="טוען..." />
    </div>
  );
}
