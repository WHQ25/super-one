import type { MDXComponents } from "mdx/types"

const components: MDXComponents = {
  h2: ({ children, ...props }) => (
    <h2
      className="text-foreground/90 mt-10 mb-3 text-xl font-semibold tracking-tight"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3
      className="text-foreground/90 mt-8 mb-2 text-base font-semibold"
      {...props}
    >
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="text-foreground/80 my-4 leading-relaxed" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul
      className="text-foreground/80 my-4 list-disc space-y-1.5 pl-6 leading-relaxed marker:text-muted-foreground"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      className="text-foreground/80 my-4 list-decimal space-y-1.5 pl-6 leading-relaxed marker:text-muted-foreground"
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => <li {...props}>{children}</li>,
  strong: ({ children, ...props }) => (
    <strong className="text-foreground font-semibold" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="text-foreground/90 italic" {...props}>
      {children}
    </em>
  ),
  code: ({ children, ...props }) => (
    <code
      className="bg-muted text-foreground/90 rounded px-1.5 py-0.5 font-mono text-[0.85em]"
      {...props}
    >
      {children}
    </code>
  ),
  kbd: ({ children, ...props }) => (
    <kbd
      className="border-border bg-card text-muted-foreground inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[0.8em]"
      {...props}
    >
      {children}
    </kbd>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-border text-muted-foreground my-5 border-l-2 pl-4 italic"
      {...props}
    >
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-primary underline-offset-4 hover:underline"
      {...props}
    >
      {children}
    </a>
  ),
  hr: (props) => <hr className="border-border my-8" {...props} />,
}

export function useMDXComponents(): MDXComponents {
  return components
}
