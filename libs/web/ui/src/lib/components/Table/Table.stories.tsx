import type { Meta, StoryObj } from '@storybook/react';
import { MoreHorizontal } from 'lucide-react';

import { Avatar, AvatarFallback } from '../Avatar/Avatar';
import { Button } from '../Button/Button';
import { Card, CardFooter, CardHeader } from '../Card/Card';
import { IconButton } from '../IconButton/IconButton';
import { Input } from '../Input/Input';
import { StatusPill, type StatusPillTone } from '../StatusPill/StatusPill';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './Table';

const TASK_ROWS = [
  {
    id: 'task-001',
    title: 'Review launch checklist',
    status: 'In progress',
    dueDate: 'Aug 12, 2026',
    assignee: 'Jane Doe',
  },
  {
    id: 'task-002',
    title: 'Send stakeholder update',
    status: 'To do',
    dueDate: 'Aug 14, 2026',
    assignee: 'Alex Kim',
  },
  {
    id: 'task-003',
    title: 'Archive completed sprint board',
    status: 'Done',
    dueDate: 'Aug 10, 2026',
    assignee: 'Sam Patel',
  },
  {
    id: 'task-004',
    title: 'Prepare Q3 roadmap draft',
    status: 'In progress',
    dueDate: 'Aug 16, 2026',
    assignee: 'Jordan Lee',
  },
  {
    id: 'task-005',
    title: 'Confirm design handoff',
    status: 'To do',
    dueDate: 'Aug 18, 2026',
    assignee: 'Taylor Nguyen',
  },
  {
    id: 'task-006',
    title: 'Schedule retrospective',
    status: 'To do',
    dueDate: 'Aug 20, 2026',
    assignee: 'Jane Doe',
  },
  {
    id: 'task-007',
    title: 'Update onboarding docs',
    status: 'In progress',
    dueDate: 'Aug 22, 2026',
    assignee: 'Alex Kim',
  },
  {
    id: 'task-008',
    title: 'Audit shared folder permissions',
    status: 'To do',
    dueDate: 'Aug 25, 2026',
    assignee: 'Sam Patel',
  },
];

// Records from the Data artboard's renderVals script (docs/design/web-v2).
const USERS = [
  {
    slug: 'sam-miller',
    name: 'Sam Miller',
    initials: 'SM',
    email: 'sam@example.com',
    role: 'Admin',
    status: 'Active',
    joined: '12 Jan 2026',
  },
  {
    slug: 'priya-shah',
    name: 'Priya Shah',
    initials: 'PS',
    email: 'priya@example.com',
    role: 'User',
    status: 'Unverified',
    joined: '3 Oct 2026',
  },
  {
    slug: 'leo-martin',
    name: 'Leo Martin',
    initials: 'LM',
    email: 'leo@example.com',
    role: 'User',
    status: 'Disabled',
    joined: '28 Aug 2026',
  },
  {
    slug: 'ana-costa',
    name: 'Ana Costa',
    initials: 'AC',
    email: 'ana@example.com',
    role: 'User',
    status: 'Active',
    joined: '15 Sep 2026',
  },
] as const;

const ROLE_TONE = {
  Admin: 'brand',
  User: 'neutral',
} as const satisfies Record<string, StatusPillTone>;

const STATUS_TONE = {
  Active: 'success',
  Unverified: 'warning',
  Disabled: 'danger',
} as const satisfies Record<string, StatusPillTone>;

// Long addresses and a long name, to show how the cells hold user-supplied
// text. The email cell truncates; the name wraps.
const LONG_CONTENT_ROWS = [
  {
    name: 'Alexandra Maria Konstantinou-Whitfield',
    email: 'alexandra.maria.konstantinou-whitfield@family-office.example.com',
    role: 'Admin',
  },
  {
    name: 'Ben Lee',
    email: 'ben@example.com',
    role: 'User',
  },
  {
    name: 'Omar Haddad',
    email:
      'omar.haddad.shared.household.mailbox.for.billing@example-organiser.example.org',
    role: 'User',
  },
] as const;

function TableEmptyExample() {
  return (
    <Table>
      <TableCaption>Active tasks in your workspace</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Task</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Due date</TableHead>
          <TableHead>Assignee</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell
            colSpan={4}
            className="text-center text-foreground-supporting"
          >
            No active tasks yet.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function TableOneRowExample() {
  return (
    <Table>
      <TableCaption>Active tasks in your workspace</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Task</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Due date</TableHead>
          <TableHead>Assignee</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Review launch checklist</TableCell>
          <TableCell>In progress</TableCell>
          <TableCell>Aug 12, 2026</TableCell>
          <TableCell>Jane Doe</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function TableManyRowsExample() {
  // The wrapper owns the scroll: Table's own overflow box has no height cap.
  return (
    <div className="max-h-64 w-full overflow-auto">
      <Table>
        <TableCaption>Active tasks in your workspace</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Due date</TableHead>
            <TableHead>Assignee</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {TASK_ROWS.map((task) => (
            <TableRow key={task.id}>
              <TableCell>{task.title}</TableCell>
              <TableCell>{task.status}</TableCell>
              <TableCell>{task.dueDate}</TableCell>
              <TableCell>{task.assignee}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The Users table (Data artboard). The Card supplies the toolbar in its
 * divided header and the pagination in its footer; the Table renders only the
 * rows. `overflow-hidden` on the Card clips the header row's background to the
 * card's rounded corners.
 */
function UsersInCardExample() {
  return (
    <Card className="w-full max-w-3xl overflow-hidden">
      <CardHeader divided className="flex-wrap">
        <h2 className="grow font-display text-title">
          Users{' '}
          <span className="font-medium text-body-sm text-muted-foreground">
            · 148
          </span>
        </h2>
        <Button size="sm" variant="default" aria-pressed={true}>
          All
        </Button>
        <Button size="sm" variant="outline" aria-pressed={false}>
          Admins
        </Button>
        <Button size="sm" variant="outline" aria-pressed={false}>
          Disabled
        </Button>
        <Input
          type="search"
          aria-label="Filter by name or email"
          placeholder="Filter by name or email"
          className="w-56"
        />
      </CardHeader>
      <Table aria-label="Users">
        <TableHeader>
          <TableRow>
            <TableHead aria-sort="ascending">
              Name <span aria-hidden="true">↑</span>
            </TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {USERS.map((user) => (
            <TableRow key={user.slug}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar aria-hidden="true">
                    <AvatarFallback>{user.initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col">
                    <a
                      href={`#user-${user.slug}`}
                      className="font-semibold text-foreground hover:underline"
                    >
                      {user.name}
                    </a>
                    <span className="text-caption text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <StatusPill tone={ROLE_TONE[user.role]}>{user.role}</StatusPill>
              </TableCell>
              <TableCell>
                <StatusPill tone={STATUS_TONE[user.status]}>
                  {user.status}
                </StatusPill>
              </TableCell>
              <TableCell>{user.joined}</TableCell>
              <TableCell>
                <IconButton
                  variant="ghost"
                  label={`Actions for ${user.name}`}
                  icon={<MoreHorizontal aria-hidden="true" />}
                  className="size-10"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <CardFooter className="justify-between gap-2 py-3">
        <span className="text-body-sm text-foreground-supporting">
          1–20 of 148
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
          <Button variant="outline" size="sm">
            Next
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function TableLongContentExample() {
  return (
    <div className="w-full max-w-3xl">
      <Table aria-label="Users with long names and addresses">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {LONG_CONTENT_ROWS.map((row) => (
            <TableRow key={row.email}>
              <TableCell>{row.name}</TableCell>
              <TableCell>
                <span className="block max-w-xs truncate">{row.email}</span>
              </TableCell>
              <TableCell>
                <StatusPill tone={ROLE_TONE[row.role]}>{row.role}</StatusPill>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const meta: Meta<typeof TableEmptyExample> = {
  component: TableEmptyExample,
  title: 'Components/Table',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof TableEmptyExample>;

export const Empty: Story = {};

export const OneRow: Story = {
  render: function Render() {
    return <TableOneRowExample />;
  },
};

export const ManyRows: Story = {
  render: function Render() {
    return <TableManyRowsExample />;
  },
};

export const UsersInCard: Story = {
  render: function Render() {
    return <UsersInCardExample />;
  },
};

export const LongContent: Story = {
  render: function Render() {
    return <TableLongContentExample />;
  },
};
