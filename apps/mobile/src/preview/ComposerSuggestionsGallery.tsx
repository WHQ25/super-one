import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { useMobileTheme } from '../theme/context'
import { MentionSuggestions, SlashSuggestions } from '../ui/composer-suggestions'
import { filterSlashCommands } from '../slash'
import { mentionGroup } from '../ui/mention-glyph-data'
import { previewLongMentionItems, previewMentionItems, previewSlashCatalog } from './composer-fixtures'

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
  // Each list clips at 256 px, so a section holding every group can only ever
  // show its first few rows. Split by group rather than scroll inside a list.
  const inGroup = (group: string) => previewMentionItems.filter((item) => mentionGroup(item.kind) === group)
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

    <Section title="Slash · /rel" note="The skill scores highest. Desktop leads with Skills; mobile does not.">
      <SlashSuggestions matches={slash('/rel')} onSelect={() => {}} />
    </Section>

    <Section title="Slash · /tdd" note="A skill-only match — the Commands header must disappear.">
      <SlashSuggestions matches={slash('/tdd')} onSelect={() => {}} />
    </Section>

    <Section title="Slash · no match" note="Renders nothing at all. There is no empty state today.">
      <SlashSuggestions matches={slash('/zzzz')} onSelect={() => {}} />
    </Section>

    <Section title="Mention · every group" note="Group order and per-group counts. The list clips at 256 px, so the tail groups sit in the next section.">
      <MentionSuggestions items={previewMentionItems} onSelect={() => {}} search={{ active: true, loading: false }} />
    </Section>

    <Section title="Mention · apps" note="A group the section above cuts off. Mobile merges mini-apps and desktop apps here; desktop keeps them apart.">
      <MentionSuggestions items={inGroup('Apps')} onSelect={() => {}} search={{ active: true, loading: false }} />
    </Section>

    <Section title="Mention · files" note="Directory first, then files. The CJK name has to survive the basename split.">
      <MentionSuggestions items={inGroup('Files & folders')} onSelect={() => {}} search={{ active: true, loading: false }} />
    </Section>

    <Section title="Mention · searching" note="Rows already fetched stay visible under the spinner.">
      <MentionSuggestions
        items={previewMentionItems.slice(0, 3)}
        onSelect={() => {}}
        search={{ active: true, loading: true }}
      />
    </Section>

    <Section title="Mention · search failed" note="Message plus a retry the user can actually reach.">
      <MentionSuggestions
        items={[]}
        onSelect={() => {}}
        search={{ active: true, loading: false, error: 'Could not reach the desktop' }}
        onRetry={() => {}}
      />
    </Section>

    <Section title="Mention · no matches" note="Settled search, nothing found.">
      <MentionSuggestions items={[]} onSelect={() => {}} search={{ active: true, loading: false }} />
    </Section>

    <Section title="Mention · truncation" note="Long path, and a row with no label at all.">
      <MentionSuggestions items={previewLongMentionItems} onSelect={() => {}} search={{ active: true, loading: false }} />
    </Section>
  </ScrollView>
}
