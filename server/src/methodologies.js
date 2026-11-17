// Default status workflows per project methodology.
// When a list is created, these are copied into list_statuses (and can be edited per list).
const METHODOLOGIES = {
  SDLC: {
    label: 'SDLC (Waterfall)',
    description: 'Sequential phases: requirements → design → build → test → deploy.',
    statuses: [
      { name: 'Requirement Analysis', color: '#64748b' },
      { name: 'Design', color: '#8b5cf6' },
      { name: 'Development', color: '#3b82f6' },
      { name: 'In Testing', color: '#f59e0b' },
      { name: 'In Update', color: '#f97316' },
      { name: 'Deployment', color: '#06b6d4' },
      { name: 'Delivered', color: '#22c55e', is_done: true },
    ],
  },
  AGILE: {
    label: 'Agile',
    description: 'Iterative delivery with review and approval loops.',
    statuses: [
      { name: 'Backlog', color: '#64748b' },
      { name: 'To Do', color: '#94a3b8' },
      { name: 'In Progress', color: '#3b82f6' },
      { name: 'In Testing', color: '#f59e0b' },
      { name: 'In Update', color: '#f97316' },
      { name: 'Approved', color: '#14b8a6' },
      { name: 'Delivered', color: '#22c55e', is_done: true },
    ],
  },
  SCRUM: {
    label: 'Scrum',
    description: 'Sprint based: product backlog → sprint backlog → done.',
    statuses: [
      { name: 'Product Backlog', color: '#64748b' },
      { name: 'Sprint Backlog', color: '#94a3b8' },
      { name: 'In Progress', color: '#3b82f6' },
      { name: 'Code Review', color: '#8b5cf6' },
      { name: 'In Testing', color: '#f59e0b' },
      { name: 'Approved', color: '#14b8a6' },
      { name: 'Done', color: '#22c55e', is_done: true },
    ],
  },
  KANBAN: {
    label: 'Kanban',
    description: 'Continuous flow board.',
    statuses: [
      { name: 'Backlog', color: '#64748b' },
      { name: 'To Do', color: '#94a3b8' },
      { name: 'In Progress', color: '#3b82f6' },
      { name: 'In Testing', color: '#f59e0b' },
      { name: 'Approved', color: '#14b8a6' },
      { name: 'Delivered', color: '#22c55e', is_done: true },
    ],
  },
  CUSTOM: {
    label: 'Custom',
    description: 'Define your own statuses.',
    statuses: [
      { name: 'To Do', color: '#94a3b8' },
      { name: 'In Progress', color: '#3b82f6' },
      { name: 'Done', color: '#22c55e', is_done: true },
    ],
  },
};

module.exports = { METHODOLOGIES };
