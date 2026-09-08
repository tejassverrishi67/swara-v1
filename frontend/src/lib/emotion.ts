/**
 * A small emoji for a suggested emotion label. Matching is loose (substring) so
 * model-generated variants like "Neutral / calm" or "Anxious / worried" still get
 * an icon; anything unrecognised falls back to a speech bubble. Decorative only —
 * the word itself is the label.
 */
export function emotionIcon(emotion: string): string {
  const e = emotion.toLowerCase();
  const table: Array<[RegExp, string]> = [
    [/sad|down|upset|grief|hurt\b|downhearted/, "😢"],
    [/frustrat|annoy|irritat/, "😤"],
    [/angry|anger|mad/, "😠"],
    [/anx|worr|nervous|scared|afraid|fear/, "😟"],
    [/tired|exhaust|weary|fatigue/, "😮‍💨"],
    [/hope|optimis|reassur|relieved/, "🙂"],
    [/grateful|thank|appreci/, "🙏"],
    [/embarrass|ashamed|awkward/, "😳"],
    [/pain|ache|sore/, "😣"],
    [/calm|neutral|matter-of-fact|plain|factual|even/, "😐"],
  ];
  for (const [re, icon] of table) if (re.test(e)) return icon;
  return "🗨️";
}
