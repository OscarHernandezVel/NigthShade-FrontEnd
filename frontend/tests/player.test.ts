import { describe, expect, it } from 'vitest';
import { Playlist } from '../../shared/library-service';
import { PlaybackController, formatTime, parseTime } from '../src/player/player';

const playlist = () => new Playlist('p1', 'Mix', false, ['a', 'b', 'c', 'd']);

describe('PlaybackController', () => {
  it('walks the playlist with next/previous pointers', () => {
    const controller = new PlaybackController();
    expect(controller.startPlaylist(playlist(), 1)).toBe('b');
    expect(controller.next()).toBe('c');
    expect(controller.next()).toBe('d');
    expect(controller.next()).toBeNull();
    expect(controller.previous()).toBe('c');
  });

  it('plays queued songs first (FIFO), then resumes the playlist', () => {
    const controller = new PlaybackController();
    controller.startPlaylist(playlist(), 0);
    controller.enqueue('x', 'y');
    expect([controller.next(), controller.next(), controller.next()]).toEqual(['x', 'y', 'b']);
  });

  it('keeps its place when the playlist is reordered by drag & drop', () => {
    const list = playlist();
    const controller = new PlaybackController();
    controller.startPlaylist(list, 1);
    list.tracks.move(1, 3);
    expect(list.tracks.toArray()).toEqual(['a', 'c', 'd', 'b']);
    expect(controller.next()).toBeNull();
    expect(controller.previous()).toBe('d');
  });

  it('re-anchors when the current node is removed or the playlist is reloaded', () => {
    const list = playlist();
    const controller = new PlaybackController();
    controller.startPlaylist(list, 1);
    list.tracks.removeAt(1);
    list.tracks.insertAt(2, 'b');
    expect(controller.next()).toBe('d');

    let live = list;
    const reloading = new PlaybackController(() => live);
    reloading.startPlaylist(list, 0);
    live = new Playlist('p1', 'Mix', false, ['z', 'a', 'q']);
    expect(reloading.next()).toBe('q');
  });

  it('forgets removed songs from the queue', () => {
    const controller = new PlaybackController();
    controller.enqueue('a', 'b', 'a');
    controller.forget('a');
    expect(controller.queue.toArray()).toEqual(['b']);
  });
});

describe('time helpers', () => {
  it('formats and parses times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(75.9)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(parseTime('90')).toBe(90);
    expect(parseTime('1:30')).toBe(90);
    expect(parseTime('1:02:05')).toBe(3725);
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('1::2')).toBeNull();
  });
});
