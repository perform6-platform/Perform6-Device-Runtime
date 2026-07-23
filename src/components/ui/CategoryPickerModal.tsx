import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import type { P6Accent } from './types';

export type CategoryPickerItem = {
  id: string;
  label: string;
};

export type CategoryPickerVideo = {
  id: string;
  title: string;
  duration: string;
  thumbnail: string;
};

type CategoryPickerModalProps = {
  open: boolean;
  onClose: () => void;
  onVideoSelect: (categoryId: string, videoId: string) => void;
  title: string;
  subtitle?: string;
  duration?: string;
  categories: CategoryPickerItem[];
  videosByCategory: Record<string, CategoryPickerVideo[]>;
  accent?: P6Accent;
  className?: string;
};

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2 2l10 10M12 2L2 12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M5 3.5v7l6-3.5-6-3.5z" fill="currentColor" />
    </svg>
  );
}

export function CategoryPickerModal({
  open,
  onClose,
  onVideoSelect,
  title,
  subtitle = 'Select a category, then choose a video',
  duration,
  categories,
  videosByCategory,
  accent = 'cyan',
  className,
}: CategoryPickerModalProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState(categories[0]?.id ?? '');

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open && categories[0]) {
      setSelectedCategoryId(categories[0].id);
    }
  }, [open, categories]);

  if (!open) return null;

  const videos = videosByCategory[selectedCategoryId] ?? [];
  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);

  return createPortal(
    <div className="p6-modal-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="p6-category-picker-title"
        className={cn(
          'p6-session-modal p6-category-picker',
          `p6-session-modal--${accent}`,
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="p6-session-modal__close"
          onClick={onClose}
          aria-label="Close"
        >
          <CloseIcon />
        </button>

        <header className="p6-category-picker__header">
          <h2 id="p6-category-picker-title" className="p6-category-picker__title">
            {title}
          </h2>
          <p className="p6-category-picker__subtitle">{subtitle}</p>
        </header>

        <div className="p6-category-picker__body">
          <aside className="p6-category-picker__sidebar">
            <p className="p6-category-picker__sidebar-label">Categories</p>
            <ul className="p6-category-picker__category-list">
              {categories.map((category) => (
                <li key={category.id}>
                  <button
                    type="button"
                    className={cn(
                      'p6-category-picker__category',
                      selectedCategoryId === category.id &&
                        'p6-category-picker__category--active',
                    )}
                    onClick={() => setSelectedCategoryId(category.id)}
                  >
                    {category.label}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="p6-category-picker__videos">
            <p className="p6-category-picker__videos-label">
              {selectedCategory?.label ?? 'Videos'}
            </p>
            {videos.length > 0 ? (
              <div className="p6-category-picker__video-grid">
                {videos.map((video) => (
                  <button
                    key={video.id}
                    type="button"
                    className="p6-category-picker__video-card"
                    onClick={() => onVideoSelect(selectedCategoryId, video.id)}
                  >
                    <div className="p6-category-picker__video-thumb">
                      <img src={video.thumbnail} alt="" draggable={false} />
                      <span className="p6-category-picker__video-play">
                        <PlayIcon />
                      </span>
                    </div>
                    <div className="p6-category-picker__video-info">
                      <span className="p6-category-picker__video-title">{video.title}</span>
                      <span className="p6-category-picker__video-duration">
                        {video.duration}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="p6-category-picker__empty">No videos in this category yet.</p>
            )}
          </div>
        </div>

        {duration && <p className="p6-category-picker__duration">{duration}</p>}
      </div>
    </div>,
    document.body,
  );
}
