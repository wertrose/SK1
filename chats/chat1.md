# Casio SK-1 sampling keyboard

_Started 2026-07-14 03:22 UTC_

---

## User

I would like a website that acts like the sampling funtion of the famous casio SK-1 sampling keyboard. It would allow a user to record up to 1.4 seconds of any sound (sample) and it would play it back exactly like the casio sk-1. It was the song "toy symphony" by mozart, but it would use the sound you sampled. It would change the tempo and pitch. 

Also if could have the keyboard and use the sample and match the tone/pitch to what it should be on the keyboard.

Basically a website that looks and acts like an SK-1 keyboard from Casio. Mainly the sampling part

## Assistant

_[tool: questions_v2]_

## User

Questions answered:
- scope_note: Yes, original design is fine
- keyboard_size: 1 octave (mini, like SK-1)
- input_method: Click/tap on-screen keys
- recording_source: Decide for me
- song_feature: Prominent 'Play Demo Song' button using my sample, with tempo/pitch sliders
- pitch_behavior: Classic sampler behavior: recorded note = one key, other keys pitch-shift up/down from it
- extra_features: None — keep it minimal
- device_target: Mobile

## Assistant

_[tool: dc_write]_

_[tool: ready_for_verification]_

Built an original mini-keyboard sampler (not a Casio replica): 1-octave click keyboard, REC/PLAY/CLEAR with mic capture (auto-stops at 1.4s), pitch-shifted playback across keys, and a "Toy Symphony" demo with tempo/pitch sliders. Tweaks panel has lo-fi filter toggle, max sample length, and default tempo.

## User

can you make it more like the SK1 Black and orange buttons. And maybe say demo vs play. Sample vs record

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Recolored to black case with orange accents, and relabeled buttons: SAMPLE/PLAY for the recorder, DEMO/STOP for the song.

## User

this is what it looks like.
Sample is the record button
Demo is the play button and it is gray.
Tempo is up and down buttons.

## Assistant

_[tool: dc_js_str_replace]_

Now swap the tempo slider for up/down buttons.

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Demo button is now gray, and tempo is up/down buttons with a BPM readout.

## User

looks great. I was thinking it should be made to fit a phone in portrait, and then flip it to landscape to get the keyboard

## Assistant

_[tool: read_file]_

_[tool: str_replace_edit]_

Now remove the keyboard block from the portrait panel, add a rotate hint, close the portrait div properly, and add the landscape panel with its own keyboard + mini transport strip.

_[tool: str_replace_edit]_

_[tool: ready_for_verification]_

Portrait now shows the control panel with a "rotate for keyboard" hint; rotating to landscape swaps to a full-width keyboard with a compact status/transport strip up top.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Fixed — white-key row now uses `flex:1` instead of `height:100%` so it fills the landscape keyboard area properly.

