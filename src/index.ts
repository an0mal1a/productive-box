import { Octokit } from '@octokit/rest';
import { config } from 'dotenv';

import githubQuery from './githubQuery.js';
import {
  createCommittedDateQuery,
  createContributedRepoQuery,
  userInfoQuery,
} from './queries.js';

config();

interface IRepo {
  name: string;
  owner: string;
}

interface RepoInfo {
  name: string;
  owner: {
    login: string;
  };
  isFork: boolean;
}

interface Edge {
  node: {
    committedDate: string;
  };
}

interface Stat {
  label: string;
  commits: number;
  percent: number;
}

type TimeType = 'morning' | 'daytime' | 'evening' | 'night';

function getEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

/**
 * Small inline SVG icons.
 *
 * No emoji/fonts involved, so rendering is consistent
 * when GitHub serves the SVG.
 */
function getTimeIcon(
  type: TimeType,
  x: number,
  y: number,
): string {
  const common = `
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
  `;

  switch (type) {
    /**
     * Sunrise
     */
    case 'morning':
      return `
        <g
          transform="translate(${x} ${y})"
          class="time-icon"
        >
          <path ${common} d="M2 15h16" />
          <path ${common} d="M5 15a5 5 0 0 1 10 0" />
          <path ${common} d="M10 2v3" />
          <path ${common} d="M4.5 6l2 2" />
          <path ${common} d="M15.5 6l-2 2" />
          <path ${common} d="M2 10h3" />
          <path ${common} d="M15 10h3" />
        </g>
      `;

    /**
     * Sun
     */
    case 'daytime':
      return `
        <g
          transform="translate(${x} ${y})"
          class="time-icon"
        >
          <circle ${common} cx="10" cy="10" r="4" />
          <path ${common} d="M10 1v2" />
          <path ${common} d="M10 17v2" />
          <path ${common} d="M1 10h2" />
          <path ${common} d="M17 10h2" />
          <path ${common} d="M3.6 3.6l1.4 1.4" />
          <path ${common} d="M15 15l1.4 1.4" />
          <path ${common} d="M16.4 3.6L15 5" />
          <path ${common} d="M5 15l-1.4 1.4" />
        </g>
      `;

    /**
     * Sunset
     */
    case 'evening':
      return `
        <g
          transform="translate(${x} ${y})"
          class="time-icon"
        >
          <path ${common} d="M2 14h16" />
          <path ${common} d="M5 14a5 5 0 0 1 10 0" />
          <path ${common} d="M4 17h12" />
          <path ${common} d="M10 2v3" />
          <path ${common} d="M4.5 6l2 2" />
          <path ${common} d="M15.5 6l-2 2" />
        </g>
      `;

    /**
     * Crescent moon + stars
     */
    case 'night':
      return `
        <g
          transform="translate(${x} ${y})"
          class="time-icon"
        >
          <path
            ${common}
            d="
              M14.5 13.5
              A7 7 0 0 1 6.5 4
              A7 7 0 1 0 14.5 13.5
              Z
            "
          />

          <path ${common} d="M15 2.5v2" />
          <path ${common} d="M14 3.5h2" />

          <path ${common} d="M18 7v1.5" />
          <path ${common} d="M17.25 7.75h1.5" />
        </g>
      `;
  }
}

function generateSvg(
  stats: Stat[],
  total: number,
): string {
  /**
   * Height deliberately matches the compact card
   * used next to the other profile statistics.
   */
  const width = 400;
  const height = 158.7;

  /**
   * Horizontal layout:
   *
   * icon | label | progress bar | %
   */
  const iconX = 20;
  const labelX = 46;

  const barX = 135;
  const barWidth = 155;

  /**
   * Compact vertical distribution.
   */
  const rowStart = 56;
  const rowHeight = 23;

  const iconTypes: TimeType[] = [
    'morning',
    'daytime',
    'evening',
    'night',
  ];

  const rows = stats
    .map((stat, index) => {
      const y = rowStart + index * rowHeight;

      const filledWidth = Math.max(
        0,
        Math.min(
          barWidth,
          (stat.percent / 100) * barWidth,
        ),
      );

      const icon = getTimeIcon(
        iconTypes[index],
        iconX,
        y - 6,
      );

      return `
        ${icon}

        <text
          x="${labelX}"
          y="${y + 8}"
          class="label"
        >${stat.label}</text>

        <rect
          x="${barX}"
          y="${y}"
          width="${barWidth}"
          height="8"
          rx="4"
          class="bar-bg"
        />

        <rect
          x="${barX}"
          y="${y}"
          width="${filledWidth.toFixed(2)}"
          height="8"
          rx="4"
          class="bar"
        />

        <text
          x="380"
          y="${y + 8}"
          text-anchor="end"
          class="percentage"
        >${stat.percent.toFixed(1)}%</text>
      `;
    })
    .join('\n');

  return `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${width}"
  height="${height}"
  viewBox="0 0 ${width} ${height}"
  role="img"
  aria-labelledby="title desc"
>
  <title id="title">
    Coding Activity
  </title>

  <desc id="desc">
    Distribution of ${total} recent commits by time of day
  </desc>

  <style>
    text {
      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Helvetica,
        Arial,
        sans-serif;
    }

    .title {
      fill: #58a6ff;
      font-size: 16px;
      font-weight: 600;
    }

    .subtitle {
      fill: #8b949e;
      font-size: 10px;
    }

    .label {
      fill: #c9d1d9;
      font-size: 11px;
    }

    .percentage {
      fill: #8b949e;
      font-size: 10px;
    }

    .bar-bg {
      fill: #21262d;
    }

    .bar {
      fill: #2f81f7;
    }

    .time-icon {
      color: #58a6ff;
    }
  </style>

  <!-- Card -->
  <rect
    x="0.5"
    y="0.5"
    width="${width - 1}"
    height="${height - 1}"
    rx="6"
    fill="#0d1117"
    stroke="#1F242A"
  />

  <!-- Header -->
  <text
    x="20"
    y="24"
    class="title"
  >Coding Activity</text>

  <text
    x="20"
    y="41"
    class="subtitle"
  >${total} recent commits</text>

  <!-- Statistics -->
  ${rows}
</svg>
`.trim();
}

(async () => {
  try {
    const token = getEnv('GH_TOKEN');
    const gistId = getEnv('GIST_ID');
    const timezone = getEnv('TIMEZONE');

    /**
     * --------------------------------------------------------
     * 1. Authenticated user
     * --------------------------------------------------------
     */
    const userResponse = await githubQuery(
      userInfoQuery,
    );

    if (
      userResponse?.message === 'Bad credentials'
    ) {
      throw new Error(
        'Invalid GitHub token. Please renew GH_TOKEN.',
      );
    }

    if (userResponse?.errors?.length) {
      throw new Error(
        `GitHub GraphQL error: ${
          userResponse.errors
            .map(
              (error: { message?: string }) =>
                error.message ?? 'Unknown error',
            )
            .join(' | ')
        }`,
      );
    }

    const {
      login: username,
      id,
    } = userResponse?.data?.viewer ?? {};

    if (!username || !id) {
      throw new Error(
        `Unable to get GitHub username/id from authenticated token. Response: ${
          JSON.stringify(userResponse)
        }`,
      );
    }

    console.log(
      `Authenticated as ${username}`,
    );

    /**
     * --------------------------------------------------------
     * 2. Discover repositories
     * --------------------------------------------------------
     *
     * Includes private repositories when GH_TOKEN can access
     * them.
     */
    const contributedRepoQuery =
      createContributedRepoQuery(username);

    const repoResponse = await githubQuery(
      contributedRepoQuery,
    );

    if (
      repoResponse?.message === 'Bad credentials'
    ) {
      throw new Error(
        'Invalid GitHub token. Please renew GH_TOKEN.',
      );
    }

    if (repoResponse?.errors?.length) {
      throw new Error(
        `Unable to get repositories: ${
          repoResponse.errors
            .map(
              (error: { message?: string }) =>
                error.message ?? 'Unknown error',
            )
            .join(' | ')
        }`,
      );
    }

    const repoNodes =
      repoResponse
        ?.data
        ?.user
        ?.repositoriesContributedTo
        ?.nodes ?? [];

    const repos: IRepo[] = repoNodes
      .filter(
        (
          repoInfo: RepoInfo | null,
        ): repoInfo is RepoInfo =>
          repoInfo !== null &&
          !repoInfo.isFork,
      )
      .map(
        (repoInfo: RepoInfo) => ({
          name: repoInfo.name,
          owner: repoInfo.owner.login,
        }),
      );

    console.log(
      `Found ${repos.length} repositories`,
    );

    if (!repos.length) {
      throw new Error(
        'No repositories found.',
      );
    }

    /**
     * --------------------------------------------------------
     * 3. Query commits
     * --------------------------------------------------------
     */
    const committedTimeResponseMap =
      await Promise.all(
        repos.map(
          async ({
            name,
            owner,
          }) => {
            try {
              const response =
                await githubQuery(
                  createCommittedDateQuery(
                    id,
                    name,
                    owner,
                  ),
                );

              if (
                response?.errors?.length
              ) {
                console.warn(
                  `Skipping ${owner}/${name}: ${
                    response.errors
                      .map(
                        (
                          error: {
                            message?: string;
                          },
                        ) =>
                          error.message ??
                          'Unknown error',
                      )
                      .join(', ')
                  }`,
                );

                return null;
              }

              return response;
            } catch (error) {
              console.warn(
                `Skipping ${owner}/${name}: ${String(
                  error,
                )}`,
              );

              return null;
            }
          },
        ),
      );

    /**
     * --------------------------------------------------------
     * 4. Group commits by time
     * --------------------------------------------------------
     *
     * Morning   06:00 - 11:59
     * Daytime   12:00 - 17:59
     * Evening   18:00 - 23:59
     * Night     00:00 - 05:59
     */
    let morning = 0;
    let daytime = 0;
    let evening = 0;
    let night = 0;

    for (
      const committedTimeResponse
      of committedTimeResponseMap
    ) {
      if (!committedTimeResponse) {
        continue;
      }

      const edges: Edge[] =
        committedTimeResponse
          ?.data
          ?.repository
          ?.defaultBranchRef
          ?.target
          ?.history
          ?.edges ?? [];

      for (const edge of edges) {
        const committedDate =
          edge?.node?.committedDate;

        if (!committedDate) {
          continue;
        }

        const timeString =
          new Date(
            committedDate,
          ).toLocaleTimeString(
            'en-US',
            {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              timeZone: timezone,
            },
          );

        const hour = Number(
          timeString.split(':')[0],
        );

        if (
          hour >= 6 &&
          hour < 12
        ) {
          morning++;
        } else if (
          hour >= 12 &&
          hour < 18
        ) {
          daytime++;
        } else if (
          hour >= 18 &&
          hour < 24
        ) {
          evening++;
        } else {
          night++;
        }
      }
    }

    const total =
      morning +
      daytime +
      evening +
      night;

    if (!total) {
      throw new Error(
        'No commits found.',
      );
    }

    /**
     * --------------------------------------------------------
     * 5. Statistics
     * --------------------------------------------------------
     */
    const stats: Stat[] = [
      {
        label: 'Morning',
        commits: morning,
        percent:
          (morning / total) * 100,
      },
      {
        label: 'Daytime',
        commits: daytime,
        percent:
          (daytime / total) * 100,
      },
      {
        label: 'Evening',
        commits: evening,
        percent:
          (evening / total) * 100,
      },
      {
        label: 'Night',
        commits: night,
        percent:
          (night / total) * 100,
      },
    ];

    /**
     * --------------------------------------------------------
     * 6. Generate SVG
     * --------------------------------------------------------
     */
    const svg = generateSvg(
      stats,
      total,
    );

    /**
     * --------------------------------------------------------
     * 7. Update Gist
     * --------------------------------------------------------
     */
    const octokit = new Octokit({
      auth: `token ${token}`,
    });

    const gist =
      await octokit.gists.get({
        gist_id: gistId,
      });

    if (!gist.data.files) {
      throw new Error(
        'No files found in Gist.',
      );
    }

    const filenames = Object.keys(
      gist.data.files,
    );

    if (!filenames.length) {
      throw new Error(
        'Gist contains no files.',
      );
    }

    /**
     * If productive-box.svg already exists, update it.
     *
     * Otherwise rename the first Gist file to
     * productive-box.svg.
     */
    const currentFilename =
      filenames.includes(
        'productive-box.svg',
      )
        ? 'productive-box.svg'
        : filenames[0];

    await octokit.gists.update({
      gist_id: gistId,

      files: {
        [currentFilename]: {
          filename:
            'productive-box.svg',
          content: svg,
        },
      },
    });

    console.log('');
    console.log(
      'Successfully updated productive-box.svg 🎉',
    );
    console.log('');
    console.log('Stats:');
    console.log(
      `Morning: ${morning}`,
    );
    console.log(
      `Daytime: ${daytime}`,
    );
    console.log(
      `Evening: ${evening}`,
    );
    console.log(
      `Night: ${night}`,
    );
    console.log(
      `Total: ${total}`,
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : String(error),
    );

    process.exitCode = 1;
  }
})();
