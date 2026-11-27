/* A video on a saved link's page (YouTube, Vimeo: shared/video.ts). A still with a play button until it's tapped,
   so opening the page loads nothing from YouTube; then the player, which starts where the link said (?t=). */
import { useState } from "react";
import { embedUrl, thumbOf, type Video } from "../../shared/video.ts";
import { IconPlay } from "./Icons";

export function VideoCard({ video, image, title }: { video: Video; image?: string; title: string }) {
  const [on, setOn] = useState(false);
  const still = image ?? thumbOf(video);
  return (
    <section className={`card video-card${video.vertical ? " vertical" : ""}`} aria-label="Video">
      <div className="video-frame">
        {on ? (
          <iframe src={embedUrl(video)} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <button type="button" className="video-still" aria-label={`Play ${title}`} onClick={() => setOn(true)}>
            {still && <img src={still} alt="" referrerPolicy="no-referrer" loading="lazy" />}
            <span className="video-play" aria-hidden="true"><IconPlay /></span>
          </button>
        )}
      </div>
    </section>
  );
}
