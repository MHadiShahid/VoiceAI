export const SEX_OPTIONS = ['Male', 'Female', 'Other', 'Decline to Answer'];

export const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'GU', 'VI', 'AS', 'MP',
];

/** "4155550134" -> "(415) 555-0134" */
export function formatPhone(value) {
  if (!value) return '—';
  const d = String(value).replace(/\D/g, '');
  const local = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return local.length === 10 ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : value;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "MM/DD/YYYY" -> "YYYY-MM-DD" for <input type="date">. */
export function dobToInput(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value ?? '');
  return m ? `${m[3]}-${m[1]}-${m[2]}` : '';
}

export function age(dob) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dob ?? '');
  if (!m) return null;
  const birth = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) years -= 1;
  return years;
}

export const OUTCOME_LABELS = {
  registered: 'Registered',
  updated: 'Updated',
  incomplete: 'Incomplete',
  in_progress: 'In progress',
};
