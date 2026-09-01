import { CheckCircle, Clock3, X, XCircle } from 'lucide-react';
import type { ScheduledPost } from './types';

export function getMediaCount(post: ScheduledPost) {
  if (Array.isArray(post.media_ids) && post.media_ids.length > 0) {
    return post.media_ids.length;
  }

  if (!post.mediaUrls) {
    return 0;
  }

  try {
    const parsed = JSON.parse(post.mediaUrls);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function getStatusColor(status: string) {
  switch (status) {
    case 'scheduled': return 'bg-blue-100 text-blue-800';
    case 'posted': return 'bg-green-100 text-green-800';
    case 'failed': return 'bg-red-100 text-red-800';
    case 'cancelled': return 'bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-100';
    default: return 'bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-100';
  }
}

export function getStatusIcon(status: string) {
  switch (status) {
    case 'scheduled': return <Clock3 size={14} />;
    case 'posted': return <CheckCircle size={14} />;
    case 'failed': return <XCircle size={14} />;
    case 'cancelled': return <X size={14} />;
    default: return <Clock3 size={14} />;
  }
}
