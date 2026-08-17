import { Octokit } from '@octokit/rest';
import { config } from 'dotenv';

import githubQuery from './githubQuery.js';
import { createCommittedDateQuery, userInfoQuery } from './queries.js';

config({ path: ['.env'] });

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

function env(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function generateSvg(stats: Stat[], total: number): string {
  const width = 500;
  const height = 220;

  const barX = 180;
  const barWidth = 210;
  const rowStart = 78;
  const rowHeight = 32;

  const rows = stats
    .map((stat, index) => {
      const y = rowStart + index * rowHeight;
      const filledWidth = Math.max(
        0,
        Math.min(barWidth, (stat.percent / 100) * barWidth),
      );

      return `
        <text
          x="24"
          y="${y + 12}"
          class="label"
        >${stat.label}</text>

        <rect
          x="${barX}"
          y="${y}"
          width="${barWidth}"
          height="12"
          rx="6"
          class="bar-bg"
        />

        <rect
          x="${barX}"
          y="${y}"
          width="${filledWidth.toFixed(2)}"
          height="12"
          rx="6"
          class="bar"
        />

        <text
          x="470"
          y="${y + 11}"
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
  <title id="title">Coding activity</title>
  <desc id="desc">
    Distribution of commits by time of day.
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
      fill: #f0f6fc;
      font-size: 18px;
      font-weight: 600;
    }

    .subtitle {
      fill: #8b949e;
      font-size: 12px;
    }

    .label {
      fill: #c9d1d9;
      font-size: 13px;
    }

    .percentage {
      fill: #8b949e;
      font-size: 12px;
    }

    .bar-bg {
      fill: #21262d;
    }

    .bar {
      fill: #58a6ff;
    }
  </style>

  <rect
    x="0.5"
    y="0.5"
    width="${width - 1}"
    height="${height - 1}"
    rx="8"
    fill="#0d1117"
    stroke="#30363d"
  />

  <text x="24" y="32" class="title">
    Coding activity
  </text>

  <text x="24" y="52" class="subtitle">
    ${total} recent commits
  </text>

  ${rows}
</svg>
`.trim();
}

(async () => {
  const token = env('GH_TOKEN');
  const gistId = env('GIST_ID');
  const targetOwner = env('TARGET_OWNER');
  const targetRepo = env('TARGET_REPO');
  const timezone = env('TIMEZONE');

  /**
   * Get authenticated GitHub user.
   */
  const userResponse = await githubQuery(userInfoQuery);

  if (userResponse?.message === 'Bad credentials') {
    throw new Error('Invalid GitHub token. Please renew GH_TOKEN.');
  }

  const { login: username, id } = userResponse?.data?.viewer ?? {};

  if (!username || !id) {
    throw new Error('Unable to get authenticated GitHub user.');
  }

  /**
   * Query ONLY the selected repository.
   */
  const committedTimeResponse = await githubQuery(
    createCommittedDateQuery(id, targetRepo, targetOwner),
  );

  if (committedTimeResponse?.message === 'Bad credentials') {
    throw new Error('Invalid GitHub token.');
  }

  const repository = committedTimeResponse?.data?.repository;

  if (!repository) {
    throw new Error(
      'Repository not found or GH_TOKEN does not have access to TARGET_OWNER/TARGET_REPO.',
    );
  }

  const edges: Edge[] =
    repository?.defaultBranchRef?.target?.history?.edges ?? [];

  let morning = 0; // 06 - 12
  let daytime = 0; // 12 - 18
  let evening = 0; // 18 - 24
  let night = 0; // 00 - 06

  for (const edge of edges) {
    const committedDate = edge?.node?.committedDate;

    if (!committedDate) {
      continue;
    }

    const timeString = new Date(committedDate).toLocaleTimeString('en-US', {
      hour12: false,
      timeZone: timezone,
    });

    const hour = Number(timeString.split(':')[0]);

    if (hour >= 6 && hour < 12) morning++;
    else if (hour >= 12 && hour < 18) daytime++;
    else if (hour >= 18 && hour < 24) evening++;
    else night++;
  }

  const total = morning + daytime + evening + night;

  if (!total) {
    throw new Error('No commits found for this user in the selected repository.');
  }

  const buckets = [
    { label: 'Morning', commits: morning },
    { label: 'Daytime', commits: daytime },
    { label: 'Evening', commits: evening },
    { label: 'Night', commits: night },
  ];

  const stats: Stat[] = buckets.map((item) => ({
    ...item,
    percent: (item.commits / total) * 100,
  }));

  const svg = generateSvg(stats, total);

  /**
   * Update ONLY the SVG stored in the Gist.
   */
  const octokit = new Octokit({
    auth: `token ${token}`,
  });

  await octokit.gists.update({
    gist_id: gistId,
    files: {
      'productive-box.svg': {
        content: svg,
      },
    },
  });

  console.log(`Updated productive-box.svg with ${total} commits.`);
})();
