import * as React from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { cn } from '../../lib/utils';

export interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  className?: string;
}

const CodeBlock = React.forwardRef<HTMLPreElement, CodeBlockProps>(
  ({ code, language = 'typescript', showLineNumbers = false, className }, ref) => {
    return (
      <Highlight theme={themes.vsDark} code={code.trim()} language={language}>
        {({ className: highlightClassName, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            ref={ref}
            className={cn(
              'overflow-auto rounded-md border bg-[#1e1e1e] p-4 text-sm',
              className
            )}
            style={style}
          >
            <code className={highlightClassName}>
              {tokens.map((line, i) => {
                const lineProps = getLineProps({ line, key: i });
                return (
                  <div key={i} {...lineProps} className="table-row">
                    {showLineNumbers && (
                      <span className="table-cell select-none pr-4 text-right text-muted-foreground opacity-50">
                        {i + 1}
                      </span>
                    )}
                    <span className="table-cell">
                      {line.map((token, key) => (
                        <span key={key} {...getTokenProps({ token, key })} />
                      ))}
                    </span>
                  </div>
                );
              })}
            </code>
          </pre>
        )}
      </Highlight>
    );
  }
);
CodeBlock.displayName = 'CodeBlock';

export { CodeBlock };
