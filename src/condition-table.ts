/**
 * The SDK-host agreement table of the `when` language (1.10.0,
 * events-and-triggers.md §4.3, §4.11): condition × facts → truth. The
 * player has the same table (`src/host/condition-table.json`); its
 * host-agreement test checks the two are equal, and each side evaluates
 * every row (`test/triggers.test.ts` here, `conditions_tests.rs` there).
 * Each row's facts override `defaults`.
 *
 * @internal
 */
export const CONDITION_TABLE = {
  about:
    "The SDK-host agreement table of the when language (events-and-triggers.md §4.3, §4.11): condition x facts -> truth. The SDK's copy is CONDITION_TABLE in @vestra-player/sdk/runtime; src/tests/sdk/host-agreement.test.ts checks the two are equal, the host's conditions tests and the SDK's tests evaluate every row. Each row's facts override the defaults.",
  defaults: {
    phase: "ready",
    paused: false,
    kind: "media",
    can: ["pause", "seek", "rate"],
    fullscreen: false,
    theme: "vestra",
    language: "system",
    duration: 600,
    volume: 100,
    rate: 1,
    muted: false,
    audioTrack: 1,
    audioDevice: "auto",
    looping: false,
    maximized: false,
    pip: false,
    subtitleTrack: "embedded:2",
    sourceId: 7,
    position: 30,
    time: 1800000000000,
    bound: 7,
  },
  rows: [
    {
      when: {
        phase: ["ready"],
      },
      facts: {},
      holds: true,
    },
    {
      when: {
        phase: ["empty", "ended"],
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        paused: true,
      },
      facts: {
        paused: true,
      },
      holds: true,
    },
    {
      when: {
        kind: "stream",
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        can: "seek",
      },
      facts: {},
      holds: true,
    },
    {
      when: {
        can: "snapshot",
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        fullscreen: true,
      },
      facts: {
        fullscreen: true,
      },
      holds: true,
    },
    {
      when: {
        theme: "vestra",
      },
      facts: {},
      holds: true,
    },
    {
      when: {
        language: "de",
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        duration: {
          min: 600,
        },
      },
      facts: {},
      holds: true,
    },
    {
      when: {
        duration: {
          max: 600,
        },
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        duration: {
          min: 0,
        },
      },
      facts: {
        duration: null,
      },
      holds: false,
    },
    {
      when: {
        duration: {
          max: 1,
        },
      },
      facts: {
        duration: null,
      },
      holds: false,
    },
    {
      when: {
        not: {
          duration: {
            min: 0,
          },
        },
      },
      facts: {
        duration: null,
      },
      holds: true,
    },
    {
      when: {
        volume: {
          min: 50,
          max: 101,
        },
      },
      facts: {},
      holds: true,
    },
    {
      when: {
        volume: {
          max: 100,
        },
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        rate: {
          min: 1.5,
        },
      },
      facts: {
        rate: 2,
      },
      holds: true,
    },
    {
      when: {
        rate: {
          min: 1.5,
        },
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        audioTrack: 1,
      },
      facts: {},
      holds: true,
    },
    {
      when: {
        audioTrack: 2,
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        audioTrack: 1,
      },
      facts: {
        audioTrack: null,
      },
      holds: false,
    },
    {
      when: {
        subtitleTrack: "embedded:2",
      },
      facts: {},
      holds: true,
    },
    {
      when: {
        subtitleTrack: "embedded:2",
      },
      facts: {
        subtitleTrack: null,
      },
      holds: false,
    },
    {
      when: {
        audioDevice: "auto",
      },
      facts: {},
      holds: true,
    },
    {
      when: {
        audioDevice: "auto",
      },
      facts: {
        audioDevice: null,
      },
      holds: false,
    },
    {
      when: {
        muted: true,
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        muted: false,
      },
      facts: {},
      holds: true,
    },
    {
      when: {
        maximized: true,
      },
      facts: {
        maximized: true,
      },
      holds: true,
    },
    {
      when: {
        pip: true,
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        looping: true,
      },
      facts: {
        looping: true,
      },
      holds: true,
    },
    {
      when: {
        time: {
          min: 1800000000000,
        },
      },
      facts: {},
      holds: true,
    },
    {
      when: {
        time: {
          max: 1800000000000,
        },
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        time: {
          min: 1700000000000,
          max: 1800000000001,
        },
      },
      facts: {},
      holds: true,
    },
    {
      when: {
        position: {
          ranges: [
            [10, 20],
            [30, 40],
          ],
        },
      },
      facts: {},
      holds: true,
      range: 1,
    },
    {
      when: {
        position: {
          ranges: [
            [10, 20],
            [30, 40],
          ],
        },
      },
      facts: {
        position: 40,
      },
      holds: false,
    },
    {
      when: {
        position: {
          ranges: [
            [10, 20],
            [32, 40],
          ],
          lead: 2,
        },
      },
      facts: {},
      holds: true,
      range: 1,
    },
    {
      when: {
        position: {
          ranges: [
            [10, 20],
            [33, 40],
          ],
          lead: 2,
        },
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        position: {
          ranges: [
            [25, 35],
            [20, 45],
          ],
        },
      },
      facts: {},
      holds: true,
      range: 1,
    },
    {
      when: {
        position: {
          ranges: [[29]],
        },
      },
      facts: {},
      holds: true,
      range: 0,
    },
    {
      when: {
        position: {
          ranges: [[31]],
        },
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        position: {
          ranges: [],
        },
      },
      facts: {},
      holds: false,
    },
    {
      when: {
        position: {
          ranges: [[0, 100]],
        },
      },
      facts: {
        bound: 6,
      },
      holds: false,
    },
    {
      when: {
        position: {
          ranges: [[0, 100]],
        },
      },
      facts: {
        position: null,
      },
      holds: false,
    },
    {
      when: {
        not: {
          position: {
            ranges: [[0, 100]],
          },
        },
      },
      facts: {
        position: null,
      },
      holds: true,
    },
    {
      when: {
        all: [
          {
            phase: ["ready"],
          },
          {
            paused: false,
          },
          {
            position: {
              ranges: [[20, 40]],
            },
          },
        ],
      },
      facts: {},
      holds: true,
      range: 0,
    },
    {
      when: {
        all: [
          {
            phase: ["ready"],
          },
          {
            paused: false,
          },
          {
            position: {
              ranges: [[20, 40]],
            },
          },
        ],
      },
      facts: {
        paused: true,
      },
      holds: false,
    },
    {
      when: {
        any: [
          {
            fullscreen: true,
          },
          {
            position: {
              ranges: [[20, 40]],
            },
          },
        ],
      },
      facts: {},
      holds: true,
      range: 0,
    },
    {
      when: {
        any: [
          {
            fullscreen: true,
          },
          {
            position: {
              ranges: [[50, 60]],
            },
          },
        ],
      },
      facts: {
        fullscreen: true,
      },
      holds: true,
    },
    {
      when: {
        all: [
          {
            phase: ["ready"],
          },
          {
            paused: false,
          },
          {
            fullscreen: true,
          },
        ],
      },
      facts: {
        fullscreen: true,
      },
      holds: true,
    },
    {
      when: {
        not: {
          all: [
            {
              muted: true,
            },
            {
              volume: {
                max: 10,
              },
            },
          ],
        },
      },
      facts: {},
      holds: true,
    },
  ],
};
