/**
 * @file Markdown.tsx
 * @brief Zero-dependency, sleek Markdown renderer for AI Chat bubbles & advisor responses.
 *        Supports headers, bold, italics, inline code, code blocks, lists, quotes, & tables.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useState, type ReactNode } from 'react';
import './markdown.css';

interface MarkdownProps {
  content: string;
  className?: string;
}

type Block =
  | { type: 'header'; level: number; text: string }
  | { type: 'codeblock'; lang: string; code: string }
  | { type: 'list'; items: string[]; ordered: boolean }
  | { type: 'quote'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'paragraph'; text: string };

function parseMarkdown(text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced Code Block: ```lang
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      blocks.push({ type: 'codeblock', lang, code: codeLines.join('\n') });
      continue;
    }

    // Headers: # H1, ## H2, ### H3
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      blocks.push({
        type: 'header',
        level: headerMatch[1].length,
        text: headerMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Blockquote: > quote
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    // Table: | col1 | col2 |
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (rowStr: string) =>
          rowStr
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim());

        const contentRows = tableLines.filter((l) => !/^[|\s-:]+$/.test(l));
        if (contentRows.length > 0) {
          const headers = parseRow(contentRows[0]);
          const rows = contentRows.slice(1).map(parseRow);
          blocks.push({ type: 'table', headers, rows });
          continue;
        }
      }
    }

    // Unordered / Ordered Lists: - item, * item, 1. item
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const isOrdered = /^\d+\./.test(listMatch[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
        if (!m) break;
        items.push(m[3].trim());
        i++;
      }
      blocks.push({ type: 'list', items, ordered: isOrdered });
      continue;
    }

    // Paragraph
    if (line.trim().length > 0) {
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim().length > 0 &&
        !lines[i].trim().startsWith('```') &&
        !lines[i].trim().startsWith('#') &&
        !lines[i].trim().startsWith('>') &&
        !lines[i].trim().startsWith('|') &&
        !lines[i].match(/^(\s*)([-*]|\d+\.)\s+/)
      ) {
        paraLines.push(lines[i].trim());
        i++;
      }
      blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
      continue;
    }

    i++;
  }

  return blocks;
}

function FormattedInline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let keyIdx = 0;
  let remaining = text;

  while (remaining.length > 0) {
    // Inline code `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={keyIdx++} className="md-inline-code">
          {codeMatch[1]}
        </code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)(.*?)\1/);
    if (boldMatch) {
      parts.push(<strong key={keyIdx++}>{boldMatch[2]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)(.*?)\1/);
    if (italicMatch) {
      parts.push(<em key={keyIdx++}>{italicMatch[2]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    const nextIdx = remaining.search(/[`*_]/);
    if (nextIdx === -1) {
      parts.push(remaining);
      break;
    } else if (nextIdx === 0) {
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      parts.push(remaining.slice(0, nextIdx));
      remaining = remaining.slice(nextIdx);
    }
  }

  return <>{parts}</>;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="md-codeblock">
      <div className="md-code-head">
        <span className="md-code-lang">{lang || 'code'}</span>
        <button type="button" className="md-code-copy" onClick={copy}>
          {copied ? 'copied!' : 'copy'}
        </button>
      </div>
      <pre className="md-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function BlockNode({ block }: { block: Block }) {
  switch (block.type) {
    case 'header': {
      const text = <FormattedInline text={block.text} />;
      const cls = `md-h md-h${block.level}`;
      switch (block.level) {
        case 1: return <h1 className={cls}>{text}</h1>;
        case 2: return <h2 className={cls}>{text}</h2>;
        case 3: return <h3 className={cls}>{text}</h3>;
        case 4: return <h4 className={cls}>{text}</h4>;
        case 5: return <h5 className={cls}>{text}</h5>;
        default: return <h6 className={cls}>{text}</h6>;
      }
    }
    case 'codeblock':
      return <CodeBlock lang={block.lang} code={block.code} />;
    case 'quote':
      return (
        <blockquote className="md-quote">
          <FormattedInline text={block.text} />
        </blockquote>
      );
    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul';
      return (
        <ListTag className="md-list">
          {block.items.map((item, idx) => (
            <li key={idx}>
              <FormattedInline text={item} />
            </li>
          ))}
        </ListTag>
      );
    }
    case 'table':
      return (
        <div className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {block.headers.map((h, i) => (
                  <th key={i}>
                    <FormattedInline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      <FormattedInline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return (
        <p className="md-p">
          <FormattedInline text={block.text} />
        </p>
      );
  }
}

export function Markdown({ content, className = '' }: MarkdownProps) {
  const blocks = parseMarkdown(content);
  return (
    <div className={`md-render ${className}`}>
      {blocks.map((b, i) => (
        <BlockNode key={i} block={b} />
      ))}
    </div>
  );
}
