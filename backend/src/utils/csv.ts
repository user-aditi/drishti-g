import type { Response } from 'express'

/**
 * Registers as CSV, for the people who will take them into a spreadsheet.
 *
 * Every register in this system is a table someone will eventually want to sort
 * a way the screen does not, total, or attach to an email. A CSV is the format
 * every one of those tools opens without asking.
 *
 * Two rules beyond quoting. A UTF-8 byte-order mark goes first, because without
 * it Excel reads an em dash in an address as three characters of noise. And a
 * cell that begins with =, +, - or @ is prefixed with an apostrophe, because a
 * spreadsheet executes it as a formula — and addresses and notes here are typed
 * by the public.
 */
export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | boolean | Date | null | undefined
}

function cell(value: string | number | boolean | Date | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = value instanceof Date ? value.toISOString() : String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

/** Send a CSV as a download, named with the day it was taken. */
export function sendCsv(res: Response, name: string, body: string): void {
  const day = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${day}.csv"`)
  res.setHeader('Cache-Control', 'no-store')
  res.send(body)
}

/** The most rows one export will write. Past this, narrow the filters. */
export const EXPORT_LIMIT = 50_000
