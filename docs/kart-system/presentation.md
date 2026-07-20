# Presentation Types

## Responsibility

Presentation observes runtime facts and converts them into visuals, audio, and
camera response. It must never feed values back into tire grip, force requests,
solver contacts, race timing, or kart derivation.

Current presentation types include:

- interpolated chassis and suspension transforms;
- rear-tire smoke derived from measured lateral scrub power;
- the explicit countdown burnout approximation;
- chase-camera speed framing, obstruction handling, and impact response;
- collision and drift feedback; and
- HUD/debug telemetry rendering.

`src/game/kart/kart-drift-smoke.ts` owns smoke policy. Measured final lateral
tire force multiplied by lateral contact speed produces scrub power in watts;
shared presentation thresholds convert it to continuous density. The scrub
power is runtime telemetry, while smoke density is presentation state.

## Source Of Truth

Presentation types live with their owning camera, kart-presentation, particle,
audio, or UI module. A future typed presentation registry must be
completeness-checked against this documentation rather than duplicated here as
independent numeric data.

## Units And Versioning

Presentation may consume SI runtime telemetry and convert it into normalized
visual intensity. Purely visual changes use a presentation version and do not
invalidate competitive results. If a purported presentation change alters
physics or player-control semantics, it must instead be classified and
versioned in the appropriate solver or gameplay-policy layer.
