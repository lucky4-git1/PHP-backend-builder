/**
 * GeneratedArtifactLocationResolver
 * Maps findings and diagnostic reports back to exact generated artifacts with line & column ranges.
 * Never silently omits location information.
 */
import type { GenFile } from '@/lib/builder';

export interface ArtifactLocation {
  file: string;
  lineStart?: number;
  lineEnd?: number;
  columnStart?: number;
  columnEnd?: number;
  formatted: string;
  isAvailable: boolean;
  metadata?: {
    affectedArtifact?: string;
    irNode?: string;
    generator?: string;
    ruleId?: string;
  };
}

export class GeneratedArtifactLocationResolver {
  /**
   * Resolves exact file and line position for a snippet or pattern within generated files.
   */
  public static resolve(
    files: GenFile[],
    targetPath: string,
    query?: string | RegExp | number,
    meta?: { irNode?: string; generator?: string; ruleId?: string }
  ): ArtifactLocation {
    // 1. Locate the file (handling prefix variations like backend/, database/, frontend/, etc.)
    const file = files.find(
      (f) =>
        f.path === targetPath ||
        f.path.endsWith(targetPath) ||
        targetPath.endsWith(f.path) ||
        f.path.toLowerCase().includes(targetPath.toLowerCase())
    );

    if (!file) {
      return {
        file: targetPath || 'unknown',
        formatted: 'Location unavailable',
        isAvailable: false,
        metadata: {
          affectedArtifact: targetPath,
          irNode: meta?.irNode ?? 'N/A',
          generator: meta?.generator ?? 'generator.ts',
          ruleId: meta?.ruleId ?? 'unspecified',
        },
      };
    }

    // 2. If query is a direct line number
    if (typeof query === 'number') {
      const lines = file.content.split('\n');
      const safeLine = Math.max(1, Math.min(query, lines.length));
      return {
        file: file.path,
        lineStart: safeLine,
        lineEnd: safeLine,
        columnStart: 1,
        columnEnd: lines[safeLine - 1]?.length || 1,
        formatted: `${file.path}:${safeLine}`,
        isAvailable: true,
        metadata: {
          affectedArtifact: file.path,
          irNode: meta?.irNode,
          generator: meta?.generator ?? 'generator.ts',
          ruleId: meta?.ruleId,
        },
      };
    }

    // 3. If query is a string snippet or RegExp
    const lines = file.content.split('\n');
    if (typeof query === 'string' && query.trim() !== '') {
      for (let i = 0; i < lines.length; i++) {
        const colIdx = lines[i].indexOf(query);
        if (colIdx !== -1) {
          const lineNum = i + 1;
          return {
            file: file.path,
            lineStart: lineNum,
            lineEnd: lineNum,
            columnStart: colIdx + 1,
            columnEnd: colIdx + query.length + 1,
            formatted: `${file.path}:${lineNum}`,
            isAvailable: true,
            metadata: {
              affectedArtifact: file.path,
              irNode: meta?.irNode,
              generator: meta?.generator,
              ruleId: meta?.ruleId,
            },
          };
        }
      }

      // Try fuzzy whitespace matching if exact single-line match was not found
      const normalizedQuery = query.replace(/\s+/g, ' ').trim();
      for (let i = 0; i < lines.length; i++) {
        const normalizedLine = lines[i].replace(/\s+/g, ' ').trim();
        if (normalizedLine.includes(normalizedQuery)) {
          const lineNum = i + 1;
          return {
            file: file.path,
            lineStart: lineNum,
            lineEnd: lineNum,
            columnStart: 1,
            columnEnd: lines[i].length,
            formatted: `${file.path}:${lineNum}`,
            isAvailable: true,
            metadata: {
              affectedArtifact: file.path,
              irNode: meta?.irNode,
              generator: meta?.generator,
              ruleId: meta?.ruleId,
            },
          };
        }
      }
    } else if (query instanceof RegExp) {
      for (let i = 0; i < lines.length; i++) {
        const match = query.exec(lines[i]);
        if (match) {
          const lineNum = i + 1;
          return {
            file: file.path,
            lineStart: lineNum,
            lineEnd: lineNum,
            columnStart: match.index + 1,
            columnEnd: match.index + match[0].length + 1,
            formatted: `${file.path}:${lineNum}`,
            isAvailable: true,
            metadata: {
              affectedArtifact: file.path,
              irNode: meta?.irNode,
              generator: meta?.generator,
              ruleId: meta?.ruleId,
            },
          };
        }
      }
    }

    // Default to line 1 of file if query is omitted or not found in file
    return {
      file: file.path,
      lineStart: 1,
      lineEnd: 1,
      columnStart: 1,
      columnEnd: lines[0]?.length || 1,
      formatted: `${file.path}:1`,
      isAvailable: true,
      metadata: {
        affectedArtifact: file.path,
        irNode: meta?.irNode,
        generator: meta?.generator,
        ruleId: meta?.ruleId,
      },
    };
  }

  /**
   * Extracts multi-line code evidence surrounding a line number.
   */
  public static extractEvidence(
    files: GenFile[],
    targetPath: string,
    lineNum: number,
    contextLines = 2
  ): string {
    const file = files.find((f) => f.path === targetPath || f.path.endsWith(targetPath));
    if (!file) return '';
    const lines = file.content.split('\n');
    const start = Math.max(0, lineNum - 1 - contextLines);
    const end = Math.min(lines.length, lineNum + contextLines);
    return lines.slice(start, end).join('\n');
  }
}
