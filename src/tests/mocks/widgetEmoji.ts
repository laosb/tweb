// Match the widget's build replacements when a test uses the ordinary client config.
vi.mock('@lib/richTextProcessor/getEmojiUnified', () => import('@/widget/omitted/getEmojiUnified'));
vi.mock('@lib/richTextProcessor/emojiImage', () => import('@/widget/omitted/emojiImage'));
vi.mock('@environment/emojiSupport', () => import('@/widget/emojiSupport'));
vi.mock('@environment/emojiVersionsSupport', () => import('@/widget/emojiVersionsSupport'));
