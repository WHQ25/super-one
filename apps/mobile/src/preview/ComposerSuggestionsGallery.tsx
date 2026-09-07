import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { useMobileTheme } from '../theme/context'
import { MentionSuggestions, SlashSuggestions } from '../ui/composer-suggestions'
import { filterSlashCommands } from '../slash'
import { buildMentionRows } from '../mention-rows'
import { previewAgentProfiles, previewCapabilityIds, previewLongMentionItems, previewMentionItems, previewSlashCatalog } from './composer-fixtures'

/**
 * Every state the two composer overlays can reach, in one scroll.
 *
 * It exists for the same reason the session-status gallery does: the states
 * worth reviewing are the ones a healthy session never produces. A search that
 * fails, a catalog that matches nothing, a capability the desktop has switched
 * off — reaching those by hand means unplugging the desktop or editing
 * settings mid-session.
 *
 * Slash rows run through the real `filterSlashCommands`, so the highlight
 * indices and the ranking shown here are the shipping ones, not a fixture of
 * what they ought to be.
 */
function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  const { tokens: { colors } } = useMobileTheme()
  return <View style={{ gap: 6 }}>
    <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>{title}</Text>
    {note ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{note}</Text> : null}
    {children}
  </View>
}

export function ComposerSuggestionsGallery() {
  const { tokens: { colors } } = useMobileTheme()
  const slash = (draft: string) => filterSlashCommands(draft, previewSlashCatalog)
  // Rows go through the shipping builder, so the ranking, the disabled
  // capabilities and the remapped highlights shown here are the real ones.
  const rows = (query: string) => buildMentionRows(query, {
    remote: previewMentionItems,
    agentProfiles: previewAgentProfiles,
    capabilityIds: previewCapabilityIds,
  })
  return <ScrollView testID="composer-suggestions-gallery" contentContainerStyle={{ padding: 16, gap: 20 }}>
    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
      Real overlays over a fixture catalog. Slash rows are ranked by the shipping matcher.
    </Text>

    <Section title="Slash · bare /" note="Every command, catalog order, commands before skills.">
      <SlashSuggestions matches={slash('/')} onSelect={() => {}} />
    </Section>

    <Section title="Slash · /re" note="Matches across both groups; check which group leads.">
      <SlashSuggestions matches={slash('/re')} onSelect={() => {}} />
    </Section>

    <Section title="Slash · /rel" note="The skill scores highest, so Skills leads — the group order follows the matcher.">
      <SlashSuggestions matches={slash('/rel')} onSelect={() => {}} />
    </Section>

    <Section title="Slash · /tdd" note="A skill-only match — the Commands header must disappear.">
      <SlashSuggestions matches={slash('/tdd')} onSelect={() => {}} />
    </Section>

    <Section title="Slash · multi-line draft" note="A command with context under it. Only the first line is the query.">
      <SlashSuggestions matches={slash('/re\nlook at the diff too')} onSelect={() => {}} />
    </Section>

    <Section title="Slash · no match" note="Renders nothing at all. There is no empty state for a settled catalog.">
      <SlashSuggestions matches={slash('/zzzz')} onSelect={() => {}} />
    </Section>

    <Section title="Slash · catalog loading" note="Never rendered as an empty list — that reads as 'this harness has no commands'.">
      <SlashSuggestions matches={[]} status="loading" onSelect={() => {}} />
    </Section>

    <Section title="Slash · catalog failed" note="A host that could not answer says so.">
      <SlashSuggestions matches={[]} status="error" onSelect={() => {}} />
    </Section>

    <Section title="Slash · dismissable" note="The overlay covers the draft, so there is a way out of it.">
      <SlashSuggestions matches={slash('/re')} onSelect={() => {}} onDismiss={() => {}} />
    </Section>

    <Section title="Mention · bare @" note="Capabilities and files. Desktop apps need a query, or an empty @ is a list of applications.">
      <MentionSuggestions rows={rows('')} onSelect={() => {}} search={{ active: true, loading: false }} />
    </Section>

    <Section title="Mention · @co" note="Collaborators rank by slug, so Codex leads — but capabilities still come first.">
      <MentionSuggestions rows={rows('co')} onSelect={() => {}} search={{ active: true, loading: false }} />
    </Section>

    <Section title="Mention · @safari" note="A desktop app, reachable only once something is typed.">
      <MentionSuggestions rows={rows('safari')} onSelect={() => {}} search={{ active: true, loading: false }} />
    </Section>

    <Section title="Mention · @comp" note="Host indices are scored over the whole path and remapped onto the basename.">
      <MentionSuggestions rows={rows('comp')} onSelect={() => {}} search={{ active: true, loading: false }} />
    </Section>

    <Section title="Mention · searching" note="Rows already fetched stay visible under the spinner.">
      <MentionSuggestions rows={rows('co').slice(0, 3)} onSelect={() => {}} search={{ active: true, loading: true }} />
    </Section>

    <Section title="Mention · search failed" note="Message plus a retry the user can actually reach.">
      <MentionSuggestions
        rows={[]}
        onSelect={() => {}}
        search={{ active: true, loading: false, error: 'Could not reach the desktop' }}
        onRetry={() => {}}
      />
    </Section>

    <Section title="Mention · no matches" note="Settled search, nothing found.">
      <MentionSuggestions rows={[]} onSelect={() => {}} search={{ active: true, loading: false }} />
    </Section>

    <Section title="Mention · truncation" note="Long path, and a row with no label at all.">
      <MentionSuggestions
        rows={buildMentionRows('use', { remote: previewLongMentionItems, agentProfiles: [] })}
        onSelect={() => {}}
        search={{ active: true, loading: false }}
      />
    </Section>
  </ScrollView>
}
