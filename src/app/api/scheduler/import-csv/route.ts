import { NextResponse } from 'next/server';
import { parseCsvImportFlags, prepareCsvImport } from '@/lib/csv-import';
import { createScheduledPost } from '@/lib/post-scheduler';
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return apiError('VALIDATION_ERROR', 'Missing file. Upload a CSV file.');
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      return apiError('VALIDATION_ERROR', 'Only .csv files are supported.');
    }

    const csvText = await file.text();
    const flags = parseCsvImportFlags({
      dryRun: formData.get('dry_run') as string | null,
      intervalMinutes: formData.get('interval_minutes') as string | null,
      startTime: formData.get('start_time') as string | null,
      reschedulePast: formData.get('reschedule_past') as string | null,
      accountSlot: formData.get('account_slot') as string | null,
    });

    const result = prepareCsvImport(csvText, {
      intervalMinutes: flags.intervalMinutes,
      startTime: flags.startTime,
      reschedulePast: flags.reschedulePast,
      accountSlot: flags.accountSlot,
    });

    if (result.errors.length > 0) {
      return NextResponse.json(
        {
          error: 'CSV validation failed.',
          code: 'VALIDATION_ERROR',
          totalRows: result.totalRows,
          validRows: result.posts.length,
          errors: result.errors,
          warnings: result.warnings,
          preview: result.posts.slice(0, 25).map((post) => ({
            lineNumber: post.lineNumber,
            accountSlot: post.accountSlot,
            text: post.text,
            scheduledTime: post.scheduledTime.toISOString(),
            communityId: post.communityId,
            replyToTweetId: post.replyToTweetId,
          })),
        },
        { status: 400 },
      );
    }

    if (flags.dryRun) {
      return NextResponse.json({
        dryRun: true,
        totalRows: result.totalRows,
        validRows: result.posts.length,
        errors: result.errors,
        warnings: result.warnings,
        preview: result.posts.slice(0, 100).map((post) => ({
          lineNumber: post.lineNumber,
          accountSlot: post.accountSlot,
          text: post.text,
          scheduledTime: post.scheduledTime.toISOString(),
          communityId: post.communityId,
          replyToTweetId: post.replyToTweetId,
        })),
      });
    }

    if (result.posts.length === 0) {
      return apiError('VALIDATION_ERROR', 'No valid rows to import.');
    }

    const inserted = [];
    let skipped = 0;
    for (const post of result.posts) {
      const created = await createScheduledPost({
        accountSlot: post.accountSlot,
        text: post.text,
        scheduledTime: post.scheduledTime,
        communityId: post.communityId,
        replyToTweetId: post.replyToTweetId,
      });
      if (created.skipped) {
        skipped += 1;
      } else {
        inserted.push(created.post);
      }
    }

    return NextResponse.json({
      imported: inserted.length,
      totalRows: result.totalRows,
      warnings: result.warnings,
      skipped,
      insertedPreview: inserted.slice(0, 20),
    });
  } catch (error) {
    console.error('Error importing CSV posts:', error);
    return apiError('INTERNAL_ERROR', 'Failed to import CSV posts.');
  }
}
