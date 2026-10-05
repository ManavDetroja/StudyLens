/**
 * Deterministic Test Fixtures for Video Resources and Transcripts — Day 21.
 *
 * Provides copyright-safe, realistic sample transcripts (with timestamps, SRT format,
 * plain paragraphs) and standard YouTube URL fixtures for automated testing.
 */

export const SAMPLE_YOUTUBE_URLS = Object.freeze({
    standardWatch: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    shortUrl: 'https://youtu.be/dQw4w9WgXcQ',
    embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    shortsUrl: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    withTimestamp: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
    withQueryAndChannel: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share&ab_channel=CS',
    videoId: 'dQw4w9WgXcQ',
});

export const SAMPLE_TRANSCRIPT_RAW = `00:00 Welcome to our lecture on Object-Oriented Programming principles.
00:15 Today we will cover encapsulation, inheritance, polymorphism, and abstraction.
00:45 Encapsulation is the bundling of data with the methods that operate on that data to restrict direct access.
01:15 Inheritance is a mechanism where a new class derives properties and characteristics from an existing base class.
01:45 Polymorphism allows entities such as functions or objects to have more than one form based on context.
02:15 Abstraction is the concept of hiding complex implementation details and showing only essential features to the user.
02:45 In conclusion, these four fundamental pillars enable modular, reusable, and maintainable software architecture.`;

export const SAMPLE_TRANSCRIPT_PLAIN = `Welcome to our lecture on Object-Oriented Programming principles.
Today we will cover encapsulation, inheritance, polymorphism, and abstraction.

Encapsulation is the bundling of data with the methods that operate on that data to restrict direct access.
Inheritance is a mechanism where a new class derives properties and characteristics from an existing base class.

Polymorphism allows entities such as functions or objects to have more than one form based on context.
Abstraction is the concept of hiding complex implementation details and showing only essential features to the user.

In conclusion, these four fundamental pillars enable modular, reusable, and maintainable software architecture.`;

export const SAMPLE_TRANSCRIPT_SRT = `1
00:00:00,000 --> 00:00:15,000
Welcome to our lecture on Object-Oriented Programming principles.

2
00:00:15,000 --> 00:00:45,000
Today we will cover encapsulation, inheritance, polymorphism, and abstraction.

3
00:00:45,000 --> 00:01:15,000
Encapsulation is the bundling of data with the methods that operate on that data to restrict direct access.

4
00:01:15,000 --> 00:01:45,000
Inheritance is a mechanism where a new class derives properties and characteristics from an existing base class.

5
00:01:45,000 --> 00:02:15,000
Polymorphism allows entities such as functions or objects to have more than one form based on context.

6
00:02:15,000 --> 00:02:45,000
Abstraction is the concept of hiding complex implementation details and showing only essential features to the user.`;
