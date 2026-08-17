import { Octokit } from '@octokit/rest';
import { config } from 'dotenv';

import githubQuery from './githubQuery.js';
import { createCommittedDateQuery, createContributedRepoQuery, userInfoQuery } from './queries.js';

config({ path: ['.env'] });

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

function getEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function generateSvg(stats: Stat[], total: number): string {
  const width = 400;
  const height = 190;

  const barX = 115;
  const barWidth = 180;
  const rowStart = 67;
  const rowHeight = 28;

  const rows = stats
    .map((stat, index) => {
      const y = rowStart + index * rowHeight;

      const filledWidth = Math.max(0, Math.min(barWidth, (stat.percent / 100) * barWidth));

      return `
        <text
          x="20"
          y="${y + 11}"
          class="label"
        >${stat.label}</text>

        <rect
          x="${barX}"
          y="${y}"
          width="${barWidth}"
          height="10"
          rx="5"
          class="bar-bg"
        />

        <rect
          x="${barX}"
          y="${y}"
          width="${filledWidth.toFixed(2)}"
          height="10"
          rx="5"
          class="bar"
        />

        <text
          x="380"
          y="${y + 10}"
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
  <title id="title">Coding Activity</title>

  <desc id="desc">
    Distribution of ${total} commits by time of day
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
      font-size: 17px;
      font-weight: 600;
    }

    .subtitle {
      fill: #8b949e;
      font-size: 11px;
    }

    .label {
      fill: #c9d1d9;
      font-size: 12px;
    }

    .percentage {
      fill: #8b949e;
      font-size: 11px;
    }

    .bar-bg {
      fill: #21262d;
    }

    .bar {
      fill: #2f81f7;
    }
  </style>

  <rect
    x="0.5"
    y="0.5"
    width="${width - 1}"
    height="${height - 1}"
    rx="6"
    fill="#0d1117"
    stroke="#30363d"
  />

  <text
    x="20"
    y="27"
    class="title"
  >Coding Activity</text>

  <text
    x="20"
    y="46"
    class="subtitle"
  >${total} recent commits</text>

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
     * 1. Get authenticated GitHub user.
     *
     * The owner/login comes directly from GH_TOKEN.
     */
    const userResponse = await githubQuery(userInfoQuery);

    if (userResponse?.message === 'Bad credentials') {
      throw new Error('Invalid GitHub token. Please renew GH_TOKEN.');
    }

    const { login: username, id } = userResponse?.data?.viewer ?? {};

    if (!username || !id) {
      throw new Error('Unable to get GitHub username/id from authenticated token.');
    }

    console.log(`Authenticated as ${username}`);

    /**
     * 2. Get all repositories contributed to by this user.
     *
     * This is the original productive-box behaviour.
     * Private repositories are included if GH_TOKEN can access them.
     */
    const contributedRepoQuery = createContributedRepoQuery(username);

    const repoResponse = await githubQuery(contributedRepoQuery);

    if (repoResponse?.message === 'Bad credentials') {
      throw new Error('Invalid GitHub token. Please renew GH_TOKEN.');
    }

    if (repoResponse?.errors?.length) {
      throw new Error(`Unable to get repositories: ${JSON.stringify(repoResponse.errors)}`);
    }

    const repoNodes = repoResponse?.data?.user?.repositoriesContributedTo?.nodes ?? [];

    const repos: IRepo[] = repoNodes
      .filter((repoInfo: RepoInfo | null) => {
        return repoInfo !== null && !repoInfo.isFork;
      })
      .map((repoInfo: RepoInfo) => ({
        name: repoInfo.name,
        owner: repoInfo.owner.login,
      }));

    console.log(`Found ${repos.length} repositories`);

    if (!repos.length) {
      throw new Error('No repositories found.');
    }

    /**
     * 3. Get commit timestamps from every repository.
     *
     * A failure in one repo does not kill the entire action.
     */
    const committedTimeResponseMap = await Promise.all(
      repos.map(async ({ name, owner }) => {
        try {
          const response = await githubQuery(createCommittedDateQuery(id, name, owner));

          if (response?.errors?.length) {
            console.warn(
              `Skipping ${owner}/${name}: ${response.errors
                .map((error: { message?: string }) => error.message)
                .join(', ')}`,
            );

            return null;
          }

          return response;
        } catch (error) {
          console.warn(`Skipping ${owner}/${name}: ${String(error)}`);

          return null;
        }
      }),
    );

    /**
     * 4. Count commits by local time.
     *
     * Morning:  06:00 - 11:59
     * Daytime:  12:00 - 17:59
     * Evening:  18:00 - 23:59
     * Night:    00:00 - 05:59
     */
    let morning = 0;
    let daytime = 0;
    let evening = 0;
    let night = 0;

    for (const committedTimeResponse of committedTimeResponseMap) {
      if (!committedTimeResponse) {
        continue;
      }

      const edges: Edge[] = committedTimeResponse?.data?.repository?.defaultBranchRef?.target?.history?.edges ?? [];

      for (const edge of edges) {
        const committedDate = edge?.node?.committedDate;

        if (!committedDate) {
          continue;
        }

        const timeString = new Date(committedDate).toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: timezone,
        });

        const hour = Number(timeString.split(':')[0]);

        if (hour >= 6 && hour < 12) {
          morning++;
        } else if (hour >= 12 && hour < 18) {
          daytime++;
        } else if (hour >= 18 && hour < 24) {
          evening++;
        } else {
          night++;
        }
      }
    }

    const total = morning + daytime + evening + night;

    if (!total) {
      throw new Error('No commits found.');
    }

    console.log(`Found ${total} commits`);

    /**
     * 5. Calculate percentages.
     */
    const stats: Stat[] = [
      {
        label: 'Morning',
        commits: morning,
        percent: (morning / total) * 100,
      },
      {
        label: 'Daytime',
        commits: daytime,
        percent: (daytime / total) * 100,
      },
      {
        label: 'Evening',
        commits: evening,
        percent: (evening / total) * 100,
      },
      {
        label: 'Night',
        commits: night,
        percent: (night / total) * 100,
      },
    ];

    /**
     * 6. Generate SVG.
     */
    const svg = generateSvg(stats, total);

    /**
     * 7. Update Gist.
     *
     * We first obtain its current filename and rename that file
     * to productive-box.svg, so we don't leave the original
     * placeholder file behind.
     */
    const octokit = new Octokit({
      auth: `token ${token}`,
    });

    const gist = await octokit.gists.get({
      gist_id: gistId,
    });

    if (!gist.data.files) {
      throw new Error('No file found in Gist.');
    }

    const filenames = Object.keys(gist.data.files);

    if (!filenames.length) {
      throw new Error('Gist contains no files.');
    }

    /**
     * Prefer an existing productive-box.svg.
     * Otherwise rename the first file in the Gist.
     */
    const currentFilename = filenames.includes('productive-box.svg') ? 'productive-box.svg' : filenames[0];

    await octokit.gists.update({
      gist_id: gistId,

      files: {
        [currentFilename]: {
          filename: 'productive-box.svg',
          content: svg,
        },
      },
    });

    console.log('Successfully updated productive-box.svg 🎉');

    console.log('');
    console.log('Stats:');
    console.log(`Morning: ${morning}`);
    console.log(`Daytime: ${daytime}`);
    console.log(`Evening: ${evening}`);
    console.log(`Night: ${night}`);
    console.log(`Total: ${total}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    process.exitCode = 1;
  }
})();
