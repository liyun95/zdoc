import type { Channel, DiagnosticContext, SharedDocsError } from '../types'
import type { Component } from '../site/types'

/** Offsets index the original JS string (UTF-16); line bounds are one-based, end-exclusive. */
export interface SourceSpan { start: number; end: number; startLine: number; endLine: number }
export interface MergeOrigin { channel: Channel; file?: string; line?: number }
export interface SourceSlice { text: string; span: SourceSpan }
export type BlockKind = 'heading' | 'paragraph' | 'list' | 'table' | 'blockquote' | 'fence' | 'code' | 'html' | 'tabs' | 'admonition' | 'channel' | 'reference' | 'thematic-break' | 'whitespace'
export interface MergeBlock extends SourceSlice { kind: BlockKind; origins: readonly MergeOrigin[] }
export interface MergeSeparator extends SourceSlice { kind: 'separator' }
export interface GateToken { closing: boolean; span: SourceSpan }
export interface MergeEnvelope {
  frontMatter?: SourceSlice
  imports: (SourceSlice & { component: Component })[]
}
export interface SegmentedDocument {
  source: string
  /** Start of the retained body, after generated front matter/imports only. */
  bodyStart: number
  lineOffsets: readonly number[]
  envelope: MergeEnvelope
  blocks: MergeBlock[]
  separators: MergeSeparator[]
  records: (MergeBlock | MergeSeparator)[]
  /** Actual authored tokens only; literal code/comment tags are absent. */
  gates: GateToken[]
}
export interface SegmentInput {
  markdown: string
  context?: DiagnosticContext
  /** Origins indexed by zero-based adapted output line; generated lines may be empty. */
  origins?: readonly (readonly MergeOrigin[])[]
}
export type SegmentResult = { document: SegmentedDocument } | { errors: SharedDocsError[] }
export type Alignment = { kind: 'common'; current: number; next: number }
  | { kind: 'change'; current: number[]; next: number[] }
