import { describe, expect, it } from "vitest";
import { embedUrl, parseStart, thumbOf, videoOf } from "../shared/video.ts";

describe("videos on a saved link's page", () => {
  it("find YouTube videos in every common address", () => {
    expect(videoOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ site: "youtube", id: "dQw4w9WgXcQ" });
    expect(videoOf("https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1")).toEqual({ site: "youtube", id: "dQw4w9WgXcQ" });
    expect(videoOf("https://youtu.be/dQw4w9WgXcQ?si=abc")).toEqual({ site: "youtube", id: "dQw4w9WgXcQ" });
    expect(videoOf("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual({ site: "youtube", id: "dQw4w9WgXcQ", vertical: true });
    expect(videoOf("https://www.youtube.com/live/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
    expect(videoOf("https://www.youtube.com/embed/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
  });
  it("keep the start time", () => {
    expect(videoOf("https://youtu.be/dQw4w9WgXcQ?t=90")?.start).toBe(90);
    expect(videoOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")?.start).toBe(90);
    expect(videoOf("https://vimeo.com/76979871#t=45s")?.start).toBe(45);
    expect(parseStart("1h2m3s")).toBe(3723);
    expect(parseStart("abc")).toBeUndefined();
    expect(parseStart("0")).toBeUndefined();
  });
  it("find Vimeo videos, unlisted ones with their hash", () => {
    expect(videoOf("https://vimeo.com/76979871")).toEqual({ site: "vimeo", id: "76979871" });
    expect(videoOf("https://vimeo.com/76979871/abc123def")).toEqual({ site: "vimeo", id: "76979871", hash: "abc123def" });
    expect(videoOf("https://vimeo.com/channels/staffpicks/76979871")?.id).toBe("76979871");
    expect(videoOf("https://player.vimeo.com/video/76979871?h=abc123def")).toEqual({ site: "vimeo", id: "76979871", hash: "abc123def" });
  });
  it("ignore everything else", () => {
    for (const u of ["https://www.youtube.com/@somechannel", "https://www.youtube.com/playlist?list=PL1", "https://vimeo.com/about", "https://example.com/watch?v=dQw4w9WgXcQ", "not a url", undefined, "javascript:alert(1)"]) {
      expect(videoOf(u), String(u)).toBeUndefined();
    }
  });
  it("make the player's address", () => {
    expect(embedUrl({ site: "youtube", id: "dQw4w9WgXcQ", start: 90 })).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1&autoplay=1&start=90");
    expect(embedUrl({ site: "vimeo", id: "76979871", hash: "abc", start: 5 })).toBe("https://player.vimeo.com/video/76979871?dnt=1&h=abc&autoplay=1#t=5s");
    expect(thumbOf({ site: "youtube", id: "dQw4w9WgXcQ" })).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });
});
