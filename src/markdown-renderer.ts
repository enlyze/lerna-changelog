import { GitHubUserResponse } from "./github-api";
import { CommitInfo, Release } from "./interfaces";

const UNRELEASED_TAG = "___unreleased___";
const COMMIT_FIX_REGEX = /(fix|close|resolve)(e?s|e?d)? [T#](\d+)/i;
const MARKDOWN_IDENTATION = "&nbsp;";

interface CategoryInfo {
  name: string | undefined;
  commits: CommitInfo[];
}

interface SectionInfo {
  name: string;
  categories: CategoryInfo[];
}

interface Options {
  categories: string[];
  sections: { [key: string]: string };
  baseIssueUrl: string;
  unreleasedName: string;
  title: string;
  description: string;
}

export default class MarkdownRenderer {
  private options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  public renderMarkdown(releases: Release[]) {
    // Render title and description
    let output = `# ${this.options.title}\n\n${this.options.description}\n\n`;
    // Render sections and categories
    output += releases
      .map(release => this.renderReleaseBySectionAndCategory(release))
      .filter(Boolean)
      .join("\n\n\n");
    return output ? `\n${output}` : "";
  }

  public renderRelease(release: Release): string | undefined {
    // Group commits in release by category
    const categories = this.groupByCategory(release.commits);
    const categoriesWithCommits = categories.filter(category => category.commits.length > 0);

    // Skip this iteration if there are no commits available for the release
    if (categoriesWithCommits.length === 0) return "";

    const releaseTitle = release.name === UNRELEASED_TAG ? this.options.unreleasedName : release.name;

    let markdown = `## ${releaseTitle} (${release.date})`;

    for (const category of categoriesWithCommits) {
      markdown += `\n\n#### ${category.name}\n`;

      if (this.hasPackages(category.commits)) {
        markdown += this.renderContributionsByPackage(category.commits);
      } else {
        markdown += this.renderContributionList(category.commits);
      }
    }

    if (release.contributors?.length) {
      markdown += `\n\n${this.renderContributorList(release.contributors)}`;
    }

    return markdown;
  }

  public renderReleaseBySectionAndCategory(release: Release) {
    // Filter out commits non merge commits
    const filteredCommits = release.commits.filter(commit => commit.issueNumber);
    // Group commits in release by section
    const sections = this.groupBySection(filteredCommits);

    // Render normally if there are no sections
    if (!sections || sections.length === 0) return this.renderRelease(release);

    const releaseTitle = release.name === UNRELEASED_TAG ? this.options.unreleasedName : release.name;

    let markdown = `## ${releaseTitle} (${release.date})`;

    for (const section of sections) {
      markdown += `\n\n### ${section.name}`;

      for (const category of section.categories) {
        const categoryCommits = this.renderContributionList(category.commits);
        if (categoryCommits !== "") markdown += `\n\n#### ${MARKDOWN_IDENTATION} ${category.name}\n${categoryCommits}`;
      }
    }

    if (release.contributors) {
      markdown += `\n\n${this.renderContributorList(release.contributors)}`;
    }

    return markdown;
  }

  public renderContributionsByPackage(commits: CommitInfo[]) {
    // Group commits in category by package
    const commitsByPackage: { [id: string]: CommitInfo[] } = {};
    for (const commit of commits) {
      // Array of unique packages.
      const changedPackages = commit.packages || [];

      const packageName = this.renderPackageNames(changedPackages);

      commitsByPackage[packageName] = commitsByPackage[packageName] || [];
      commitsByPackage[packageName].push(commit);
    }

    const packageNames = Object.keys(commitsByPackage);

    return packageNames
      .map(packageName => {
        const pkgCommits = commitsByPackage[packageName];
        return `* ${packageName}\n${this.renderContributionList(pkgCommits, "  ")}`;
      })
      .join("\n");
  }

  public renderPackageNames(packageNames: string[]) {
    return packageNames.length > 0 ? packageNames.map(pkg => `\`${pkg}\``).join(", ") : "Other";
  }

  public renderContributionList(commits: CommitInfo[], prefix: string = ""): string {
    return commits
      .map(commit => this.renderContribution(commit))
      .filter(Boolean)
      .map(rendered => `${prefix}* ${rendered}`)
      .join("\n");
  }

  public renderContribution(commit: CommitInfo): string | undefined {
    const issue = commit.githubIssue;
    if (issue) {
      let markdown = "";

      if (issue.number && issue.pull_request && issue.pull_request.html_url) {
        const prUrl = issue.pull_request.html_url;
        markdown += `[#${issue.number}](${prUrl}) `;
      }

      if (issue.title && issue.title.match(COMMIT_FIX_REGEX)) {
        issue.title = issue.title.replace(COMMIT_FIX_REGEX, `Closes [#$3](${this.options.baseIssueUrl}$3)`);
      }

      markdown += `${issue.title} ([@${issue.user.login}](${issue.user.html_url}))`;

      return markdown;
    }
  }

  public renderContributorList(contributors: GitHubUserResponse[]) {
    const renderedContributors = contributors.map(contributor => `- ${this.renderContributor(contributor)}`).sort();

    return `#### Committers: ${contributors.length}\n${renderedContributors.join("\n")}`;
  }

  public renderContributor(contributor: GitHubUserResponse): string {
    const userNameAndLink = `[@${contributor.login}](${contributor.html_url})`;
    if (contributor.name) {
      return `${contributor.name} (${userNameAndLink})`;
    } else {
      return userNameAndLink;
    }
  }

  private hasPackages(commits: CommitInfo[]) {
    return commits.some(commit => commit.packages !== undefined && commit.packages.length > 0);
  }

  private groupByCategory(allCommits: CommitInfo[]): CategoryInfo[] {
    return this.options.categories.map(name => {
      // Keep only the commits that have a matching label with the one
      // provided in the lerna.json config.
      let commits = allCommits.filter(commit => commit.categories && commit.categories.indexOf(name) !== -1);

      return { name, commits };
    });
  }

  private groupBySection(allCommits: CommitInfo[]): SectionInfo[] {
    // This assumes that all commits have a section
    // Passed commits should be filtered out
    // Group commits by sectionName
    const groupedBySectionName = allCommits.reduce((acc: { [key: string]: CommitInfo[] }, commit) => {
      acc[this.options.sections[commit.section]] = [...(acc[commit.section] || []), commit];
      return acc;
    }, {});

    return Object.keys(groupedBySectionName).map(key => ({
      name: key,
      categories: this.groupByCategory(groupedBySectionName[key]),
    }));
  }
}
