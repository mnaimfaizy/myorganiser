'use client';

import type {
  AdminFeedbackReportListItemDto,
  FeedbackReportKind,
  FeedbackReportStatus,
} from '@myorganiser/app-api-client';
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@myorganiser/web-ui';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import {
  FEEDBACK_REPORT_KINDS,
  FEEDBACK_REPORT_STATUSES,
  formatFeedbackReportKind,
  formatFeedbackReportStatus,
  formatFeedbackReportTimestamp,
  getStatusLabelVariant,
  trackingIssueUrl,
} from '../lib/formatFeedbackReport';

// Sentinel values for "all/unfiltered" options in selects
// Radix Select throws on empty-string values, so we use non-empty sentinels
const ALL_STATUS_VALUE = 'all';
const ALL_KIND_VALUE = 'all';

interface FeedbackFiltersProps {
  statusFilter: FeedbackReportStatus | null;
  kindFilter: FeedbackReportKind | null;
  platformFilter: string;
  issueNumberFilter: string;
  onStatusFilterChange: (status: FeedbackReportStatus | null) => void;
  onKindFilterChange: (kind: FeedbackReportKind | null) => void;
  onPlatformFilterChange: (platform: string) => void;
  onIssueNumberFilterChange: (issue: string) => void;
  onClearFilters: () => void;
}

function FeedbackFilters({
  statusFilter,
  kindFilter,
  platformFilter,
  issueNumberFilter,
  onStatusFilterChange,
  onKindFilterChange,
  onPlatformFilterChange,
  onIssueNumberFilterChange,
  onClearFilters,
}: FeedbackFiltersProps) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="status-filter" className="text-sm">
            Status
          </Label>
          <Select
            value={statusFilter ?? ALL_STATUS_VALUE}
            onValueChange={(value) =>
              onStatusFilterChange(
                value === ALL_STATUS_VALUE
                  ? null
                  : (value as FeedbackReportStatus),
              )
            }
          >
            <SelectTrigger id="status-filter">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUS_VALUE}>All statuses</SelectItem>
              {FEEDBACK_REPORT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {formatFeedbackReportStatus(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="kind-filter" className="text-sm">
            Kind
          </Label>
          <Select
            value={kindFilter ?? ALL_KIND_VALUE}
            onValueChange={(value) =>
              onKindFilterChange(
                value === ALL_KIND_VALUE ? null : (value as FeedbackReportKind),
              )
            }
          >
            <SelectTrigger id="kind-filter">
              <SelectValue placeholder="All kinds" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_KIND_VALUE}>All kinds</SelectItem>
              {FEEDBACK_REPORT_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {formatFeedbackReportKind(kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="platform-filter" className="text-sm">
            Platform
          </Label>
          <Input
            id="platform-filter"
            placeholder="Any platform"
            value={platformFilter}
            onChange={(e) => onPlatformFilterChange(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="issue-filter" className="text-sm">
            Tracking issue
          </Label>
          <Input
            id="issue-filter"
            type="number"
            placeholder="Issue number"
            value={issueNumberFilter}
            onChange={(e) => onIssueNumberFilterChange(e.target.value)}
          />
        </div>
      </div>

      <Button
        variant="outline"
        onClick={onClearFilters}
        className="w-full self-start sm:w-auto"
      >
        Clear filters
      </Button>
    </>
  );
}

export function FeedbackInboxPageClient() {
  const [reports, setReports] = useState<AdminFeedbackReportListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<FeedbackReportStatus | null>(
    null,
  );
  const [kindFilter, setKindFilter] = useState<FeedbackReportKind | null>(null);
  const [platformFilter, setPlatformFilter] = useState('');
  const [issueNumberFilter, setIssueNumberFilter] = useState('');

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const api = createPlatformAdminApi();

      // Parse the issue number and include it only if it's a valid positive integer
      const parsedIssueNumber = issueNumberFilter
        ? parseInt(issueNumberFilter, 10)
        : NaN;
      const isValidIssueNumber =
        Number.isInteger(parsedIssueNumber) && parsedIssueNumber > 0;

      const params: Parameters<typeof api.listFeedbackReports>[0] = {
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(kindFilter ? { kind: kindFilter } : {}),
        ...(platformFilter ? { platform: platformFilter } : {}),
        ...(isValidIssueNumber
          ? { trackingIssueNumber: parsedIssueNumber }
          : {}),
      };

      const response = await api.listFeedbackReports(params);
      setReports(response.data.items);
    } catch {
      setError('Unable to load feedback reports. Please try again.');
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter, platformFilter, issueNumberFilter]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const handleClearFilters = useCallback(() => {
    setStatusFilter(null);
    setKindFilter(null);
    setPlatformFilter('');
    setIssueNumberFilter('');
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>

      <FeedbackFilters
        statusFilter={statusFilter}
        kindFilter={kindFilter}
        platformFilter={platformFilter}
        issueNumberFilter={issueNumberFilter}
        onStatusFilterChange={setStatusFilter}
        onKindFilterChange={setKindFilter}
        onPlatformFilterChange={setPlatformFilter}
        onIssueNumberFilterChange={setIssueNumberFilter}
        onClearFilters={handleClearFilters}
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No feedback reports match these filters.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Report</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Tracking issue</TableHead>
              <TableHead>Sender</TableHead>
              <TableHead>Sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((report) => (
              <TableRow key={report.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/admin/feedback/${report.id}`}
                    className="text-primary hover:underline"
                  >
                    {report.title}
                  </Link>
                </TableCell>
                <TableCell>{formatFeedbackReportKind(report.kind)}</TableCell>
                <TableCell>
                  <Badge variant={getStatusLabelVariant(report.status)}>
                    {formatFeedbackReportStatus(report.status)}
                  </Badge>
                </TableCell>
                <TableCell>{report.platform}</TableCell>
                <TableCell>
                  {report.trackingIssueNumber ? (
                    <a
                      href={trackingIssueUrl(report.trackingIssueNumber)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {report.trackingIssueNumber}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {report.reporter ? (
                    <div className="grid">
                      <Link
                        href={`/admin/users/${report.reporter.id}`}
                        className="text-primary hover:underline"
                      >
                        {report.reporter.name || report.reporter.email}
                      </Link>
                      {report.reporter.name ? (
                        <span className="text-xs text-muted-foreground">
                          {report.reporter.email}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Deleted</span>
                  )}
                </TableCell>
                <TableCell>
                  {formatFeedbackReportTimestamp(report.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
