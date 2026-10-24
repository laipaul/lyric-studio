"""pnpm tap: stamping logic with a simulated keyboard and clock (no sound card needed)."""

from __future__ import annotations

import pytest

from app.tap import (
    BACKSPACE,
    ENTER,
    RESTART,
    TapSession,
    format_time,
    handle_key,
    normalise_key,
    parse_clock,
    parse_lyrics_txt,
    position_ms,
)

LYRICS = "First line\nSecond line\n\n\nThird line after a break\n\n"


def test_parses_lines_pauses_and_end() -> None:
    items = parse_lyrics_txt(LYRICS)
    assert [(i.kind, i.text, i.file_line) for i in items] == [
        ("line", "First line", 1),
        ("line", "Second line", 2),
        ("pause", "", 3),  # repeated blank lines count once
        ("line", "Third line after a break", 5),
        ("end", "", 0),  # trailing blank lines are ignored
    ]
    with pytest.raises(ValueError):
        parse_lyrics_txt("\n\n")


def _run(keys: list[tuple[str, int]]) -> TapSession:
    """Simulated session: (key, song time in ms when it was pressed)."""
    session = TapSession(parse_lyrics_txt(LYRICS))
    for key, ms in keys:
        handle_key(session, key, ms)
    return session


def test_enter_stamps_each_line_and_writes_lrc() -> None:
    session = _run([(ENTER, 11_000), (ENTER, 14_250), (ENTER, 17_500), (ENTER, 20_010), (ENTER, 24_000)])
    assert session.done
    assert session.to_lrc().splitlines() == [
        "[ar:Life Lyrics]",
        "[re:Lyric Studio - pnpm tap]",
        "[00:11.00]First line",
        "[00:14.25]Second line",
        "[00:17.50]",
        "[00:20.01]Third line after a break",
        "[00:24.00]",
    ]


def test_backspace_redoes_the_last_stamp() -> None:
    session = _run([(ENTER, 11_000), (ENTER, 14_900), (BACKSPACE, 15_000), (ENTER, 14_250)])
    assert session.stamps == [11_000, 14_250]
    assert session.next_item.kind == "pause"
    assert "nothing to undo" in handle_key(TapSession(parse_lyrics_txt(LYRICS)), BACKSPACE, 0)


def test_restart_clears_everything() -> None:
    session = _run([(ENTER, 11_000), (ENTER, 14_000), (RESTART, 15_000), (ENTER, 11_100)])
    assert session.stamps == [11_100]


def test_stamps_never_go_backwards_and_stop_when_done() -> None:
    session = _run([(ENTER, 5_000), (ENTER, 4_000)])
    assert session.stamps == [5_000, 5_001]
    done = _run([(ENTER, t) for t in (1, 2, 3, 4, 5, 6, 7)])
    assert len(done.stamps) == 5


def test_printed_stamps() -> None:
    session = TapSession(parse_lyrics_txt(LYRICS))
    assert handle_key(session, ENTER, 83_456) == "  [01:23.46]  First line"
    assert format_time(59_999) == "[01:00.00]"


def test_keys() -> None:
    assert normalise_key("\r") == normalise_key("\n") == ENTER
    assert normalise_key("\x08") == normalise_key("\x7f") == BACKSPACE  # Windows / macOS-Linux
    assert normalise_key("R") == RESTART
    assert normalise_key("x") is None


def test_position_follows_the_sound_card_clock() -> None:
    sr = 48_000
    # Buffer starting at frame 0 reaches the speakers at t=10.0 s, the next (frame 480) at 10.01 s.
    records = [(10.0, 0), (10.01, 480)]
    assert position_ms(records, 9.9, sr) == 0  # not audible yet
    assert position_ms(records, 10.005, sr) == 5
    assert position_ms(records, 10.5, sr) == 500
    assert position_ms([], 1.0, sr) is None


def test_parse_clock() -> None:
    assert parse_clock("0:11") == 11_000
    assert parse_clock("1:02.5") == 62_500
    assert parse_clock("42") == 42_000
