/**
 * Curated starter concept boards (Features.md F-10).
 * =================================================
 *
 * SWARA is a layer over existing AAC boards, but a real user needs *something* to
 * say on first run. These three bundled palettes cover the common ground; a user
 * imports their own board (OBF/OBZ) or adds tiles for anything personal.
 *
 * Every label is plain English (`locale: "en-IN"`); localisation rides on
 * `Concept.labels` when a board provides it.
 */

import type { ConceptPalette } from "@swara/shared";

const c = (id: string, emoji: string, label: string, category: string) => ({ id, emoji, label, category });

export const MEDICAL_BOARD: ConceptPalette = {
  id: "medical",
  name: "Medical & symptoms",
  locale: "en-IN",
  source: "bundled",
  categories: ["People", "Body", "Sensations", "Change", "Needs", "Time"],
  concepts: [
    c("doctor", "👨‍⚕️", "doctor", "People"),
    c("nurse", "👩‍⚕️", "nurse", "People"),
    c("family", "👪", "family", "People"),
    c("me", "🙋", "me", "People"),
    c("head", "🤕", "head", "Body"),
    c("chest", "🫁", "chest", "Body"),
    c("stomach", "🤢", "stomach", "Body"),
    c("leg", "🦵", "leg", "Body"),
    c("arm", "💪", "arm", "Body"),
    c("back", "🦴", "back", "Body"),
    c("pain", "😣", "pain", "Sensations"),
    c("dizzy", "😵‍💫", "dizzy", "Sensations"),
    c("nausea", "🤮", "nausea", "Sensations"),
    c("tired", "😴", "tired", "Sensations"),
    c("cold", "🥶", "cold", "Sensations"),
    c("hot", "🥵", "hot", "Sensations"),
    c("breathless", "😮‍💨", "breathless", "Sensations"),
    c("worse", "📈", "worse", "Change"),
    c("better", "📉", "better", "Change"),
    c("same", "➖", "same", "Change"),
    c("help", "🆘", "help", "Needs"),
    c("medicine", "💊", "medicine", "Needs"),
    c("water", "💧", "water", "Needs"),
    c("toilet", "🚽", "toilet", "Needs"),
    c("want", "🙏", "want", "Needs"),
    c("now", "⏱️", "now", "Time"),
    c("today", "📅", "today", "Time"),
    c("night", "🌙", "night", "Time"),
  ],
};

export const DAILY_NEEDS_BOARD: ConceptPalette = {
  id: "daily-needs",
  name: "Daily needs",
  locale: "en-IN",
  source: "bundled",
  categories: ["Basics", "Food", "Comfort", "Actions", "People", "Time"],
  concepts: [
    c("water", "💧", "water", "Basics"),
    c("food", "🍽️", "food", "Food"),
    c("hungry", "🍞", "hungry", "Food"),
    c("thirsty", "🥤", "thirsty", "Food"),
    c("tea", "🍵", "tea", "Food"),
    c("toilet", "🚽", "toilet", "Basics"),
    c("wash", "🧼", "wash", "Basics"),
    c("sleep", "🛏️", "sleep", "Comfort"),
    c("cold", "🥶", "cold", "Comfort"),
    c("hot", "🥵", "hot", "Comfort"),
    c("blanket", "🧣", "blanket", "Comfort"),
    c("light", "💡", "light", "Comfort"),
    c("sit", "🪑", "sit", "Actions"),
    c("stand", "🧍", "stand", "Actions"),
    c("walk", "🚶", "walk", "Actions"),
    c("go", "➡️", "go", "Actions"),
    c("stop", "✋", "stop", "Actions"),
    c("want", "🙏", "want", "Actions"),
    c("help", "🆘", "help", "Actions"),
    c("me", "🙋", "me", "People"),
    c("you", "👉", "you", "People"),
    c("now", "⏱️", "now", "Time"),
    c("later", "⏳", "later", "Time"),
  ],
};

export const SOCIAL_BOARD: ConceptPalette = {
  id: "social",
  name: "Social & conversation",
  locale: "en-IN",
  source: "bundled",
  categories: ["Replies", "Feelings", "People", "Actions", "Courtesy"],
  concepts: [
    c("yes", "✅", "yes", "Replies"),
    c("no", "❌", "no", "Replies"),
    c("maybe", "🤔", "maybe", "Replies"),
    c("wait", "✋", "wait", "Replies"),
    c("dont-understand", "❓", "don't understand", "Replies"),
    c("happy", "😊", "happy", "Feelings"),
    c("sad", "😢", "sad", "Feelings"),
    c("angry", "😠", "angry", "Feelings"),
    c("scared", "😨", "scared", "Feelings"),
    c("tired", "😴", "tired", "Feelings"),
    c("love", "❤️", "love", "Feelings"),
    c("me", "🙋", "me", "People"),
    c("you", "👉", "you", "People"),
    c("friend", "🧑‍🤝‍🧑", "friend", "People"),
    c("family", "👪", "family", "People"),
    c("talk", "💬", "talk", "Actions"),
    c("listen", "👂", "listen", "Actions"),
    c("go", "➡️", "go", "Actions"),
    c("come", "⬅️", "come", "Actions"),
    c("please", "🙏", "please", "Courtesy"),
    c("thank-you", "🙌", "thank you", "Courtesy"),
    c("sorry", "😔", "sorry", "Courtesy"),
    c("hello", "👋", "hello", "Courtesy"),
    c("bye", "👋", "bye", "Courtesy"),
  ],
};

export const BUNDLED_PALETTES: ConceptPalette[] = [MEDICAL_BOARD, DAILY_NEEDS_BOARD, SOCIAL_BOARD];
