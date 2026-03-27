import { randomUUID } from 'node:crypto';

/** Генерация ID задачи */
export function generateTaskId(): string {
  return `task_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

/** Текущее время в мс */
export function now(): number {
  return Date.now();
}

/** Форматирование длительности */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/** Нормализация текста для поиска по keywords */
export function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

/** Извлечение URL из текста */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  return text.match(urlRegex) || [];
}

/** Определение типа файла по расширению */
export function getFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const types: Record<string, string> = {
    pdf: 'pdf', docx: 'docx', doc: 'docx',
    xlsx: 'excel', xls: 'excel', csv: 'csv',
    json: 'json', xml: 'xml',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
    txt: 'text', md: 'text',
  };
  return types[ext] || 'unknown';
}
