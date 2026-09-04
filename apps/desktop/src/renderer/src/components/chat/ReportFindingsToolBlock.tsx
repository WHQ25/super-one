import {
  ReportFindingsToolBlockPresenter,
  type ReportFindingsToolBlockPresenterProps,
} from '@superone/chat-view/presenters/ReportFindingsToolBlock'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import { FileChip } from './FileChip'
import { findingFileName } from './report-findings-display'

interface ReportFindingsToolBlockProps extends Omit<
  ReportFindingsToolBlockPresenterProps,
  'elapsedClassName' | 'renderFile'
> {
  stallLevel: StallLevel
}

/** Desktop adapter for file navigation and streaming stall colour. */
export function ReportFindingsToolBlock({
  stallLevel,
  ...props
}: ReportFindingsToolBlockProps) {
  return (
    <ReportFindingsToolBlockPresenter
      {...props}
      elapsedClassName={getStallColor(stallLevel)}
      renderFile={(finding) => (
        <FileChip
          name={findingFileName(finding.file)}
          title={finding.line != null ? `${finding.file}:${finding.line}` : finding.file}
          filePath={finding.file}
          lineNumber={finding.line}
          className="text-xs"
        />
      )}
    />
  )
}
