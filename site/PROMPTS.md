# Video prompts for the Veil website

The site's background films are currently free backgrounds from motionsites.ai, used through their "Copy URL" links
(see `src/home/media.tsx` and the `page-film` videos in `live.html` and `docs.html`). They are placeholders. The prompts below describe the same kind of shot
for Veil's own subject, so the site can have films it owns. Generate them in Higgsfield (or any text-to-video model), then put the
files in `public/media/` and point `FILMS` in `src/home/media.tsx` at them.

Settings for every clip: 16:9, 1920×1080, 8–10 s, 24 fps, no text, no logos, no people's faces, seamless loop (the last frame
should flow back into the first), slow camera, dark grade with deep violet (#6b52e8) and cold white light, high contrast, film grain.
Keep the left third of the frame calm and dark, because headlines sit there.

## hero — "The sealed enclave"  (replaces `enclave`)
A single obsidian sphere floats in black space, perfectly still. A thin ring of cold white light traces its edge like an eclipse,
and faint violet light breathes from inside, as if something is thinking within a sealed shell. Slow push-in, 3% over the clip.
Microscopic dust drifts through the light. Nothing ever opens. Cinematic, macro lens, shallow depth of field, deep blacks.

## trust — "The only door"  (replaces `door`)
A vast dark hall of polished stone. Far away, one tall doorway of pure white light, and a single small silhouette standing before it,
seen from behind. Fine mist rolls across the floor and catches the light. Locked-off camera with a barely perceptible drift forward.
The mood is quiet and certain, not ominous. Volumetric light, anamorphic, cool violet ambience in the shadows.

## loop card — "Measured light"  (replaces `mesh`)
A slowly undulating wireframe surface made of thousands of fine white points, like a landscape of data seen in the dark. A soft wave
passes through it from left to right every few seconds, and where it passes the points glow faint violet. Top-down three-quarter view,
very slow orbit. Clean, precise, scientific.

## visitors — "Messages crossing the world"  (replaces `globe`)
A translucent violet globe of tiny dots floats in space. Two luminous arcs of light travel around it in opposite directions, each
ending in a small bright point, like encrypted messages in transit. Stars scattered sparsely. Slow rotation of the globe.
Elegant, minimal, glowing glass and light.

## owners — "The source"  (replaces `fan`)
Seen from below, a fan of soft light rays opens upward from a single point at the bottom of the frame, violet at the centre and
warm amber at the edges, through slow-moving haze. The rays gently sway as if breathing. Dark everywhere else. Abstract, painterly,
calm.

## built — "Deep field"  (replaces `nebula`)
A slow flight through a dark nebula of violet and indigo gas lit by a distant blue-white star. Fine filaments of light drift past the
camera. Sparse stars. Very slow forward motion. Majestic and quiet, with large dark areas on the left for type.

## final — "Signal"  (replaces `bands`)
Horizontal bands of electric blue-violet light stacked vertically and softly blurred, pulsing very slowly like a calm signal, centred in
the frame and fading to black at every edge. Subtle chromatic shimmer. Abstract, symmetrical, hypnotic.
