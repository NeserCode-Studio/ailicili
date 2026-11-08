## Prohibited Behaviors

1. **Without permission**, it is prohibited to perform read and write operations on hard drives outside of this project and its derived WorkTree.
2. **Without permission**, additional content is prohibited from being installed.
3. **Without permission**, modifying or creating branches in the project's GIT repository is prohibited. Any branch-related operations require permission.

## Environment

1. Under normal circumstances, the corresponding environment and variables are obtained through the command line.
2. If the command line cannot obtain them, the `E:` directory can be checked. The nature of this directory is read-only.
3. If the available environment still cannot be provided, the user is requested to provide a solution.

## Implementation of Plans and Strategies

0. Files stored in `.agent` should not be considered for version control and should be excluded from `.gitignore`.
1. Prioritize creating a `plan.md` file in the root directory's `.agent` folder to store the plan.
2. Place detailed plans related to modules or similar module concepts in the directory `/.agent/plan-xx/yyy.md`. Also, add the corresponding index in the `/.agent/plan.md` file. For the main plan `/.agent/plan.md`, present a brief overview of the modules and important nodes and provide an index for each sub-plan.
3. During the alternate version of the plan, after organizing the old version plans, move the non-main plan files to the `/.agent/plan.v{x}-archive/` directory and rename `/.agent/plan.md` to `/.agent/plan.v{x}.md`, and update `/.agent/plan.v{x + 1}.md`.
4. During the normal iteration of the plan, reduce the reading of complex module code and instead read the main plan file or sub-plan files to quickly index to the specific code.

## Project

1. AI-generated content should be uniformly stored in the `.agent` folder at the root directory. Temporary files should be promptly cleared after they are determined not to be used, especially for scripts, screenshot files generated in each round.
2. Before generating, modifying, or deleting project files, consider the current state of the `.gitignore` file. For example, according to the first point of this section, the `.agent` directory should be excluded.
3. When the implementation progress of the coding plan in the project reaches an important milestone, consult the user for review and testing feedback, and update the `README.md` file as needed.

### Plan Strategy

1. In general, obtain the user's intention through a large number of questions and inquiries to design the plan reasonably.

### Project Review

0. By default, project review of this content should be conducted at the project milestone when the user does not mention it.
1. Plan review should be initiated at the milestone of plan design or completion, addition, etc. It should include functions,

### Special Note

1. If the project includes the tauri2 library, do not run the `tauri build` command to build the application before reaching the final output stage; Instead, tools such as `tsc` or `cargo check` should be used to perform semantic checks on TypeScript/Rust code.
2. File operations: PowerShell 7 environment should be preferred to support UTF-8 encoding.
3. **Without permission** or not for visual acceptance, testing, etc., it is prohibited to occupy machine ports to continuously run the development server.

## Coding Habits

1. During the coding process, first consider writing the configuration files of the corresponding language's formatting tools before coding, such as `.prettierrc`, `.eslintrc`, `.stylelintrc`, etc., to ensure the consistency of the code style.
2. When writing code, avoid excessive use of comments. Only provide standard-formatted comments for members with high coupling degree and complex business logic, etc.

## Skills

Note that if the current project was created by DeepSeek Harness (DSH) and is under construction, consider the skills settings within the DSH software first.

0. Default installation directory for skills: `C:\Users\{username}\.agents\skills`.
1. For actions such as project planning and code review levels within the project, prioritize the `using-superpowers` skill.
2. For actions such as interface design within the project, prioritize the `hallmark` and `ui-ux-pro-max` skills.
