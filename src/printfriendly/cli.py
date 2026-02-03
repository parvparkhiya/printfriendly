"""
PrintFriendly CLI - Convert newsletter URLs to magazine-quality PDFs.

Usage:
    printfriendly https://example.com/article
    printfriendly https://example.com/article --output article.pdf --style magazine
    printfriendly serve  # Start web interface
"""

import sys
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import typer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn

from . import __version__
from .extractor import ContentExtractor
from .analyzer import ContentAnalyzer
from .renderer import PDFRenderer

app = typer.Typer(
    name="printfriendly",
    help="Convert web newsletters into beautifully designed, magazine-quality A4 PDFs.",
    add_completion=False,
)
console = Console()


def version_callback(value: bool):
    """Print version and exit."""
    if value:
        console.print(f"PrintFriendly v{__version__}")
        raise typer.Exit()


def validate_url(url: str) -> str:
    """Validate and normalize URL."""
    parsed = urlparse(url)
    if not parsed.scheme:
        url = f"https://{url}"
        parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise typer.BadParameter(f"Invalid URL scheme: {parsed.scheme}")

    if not parsed.netloc:
        raise typer.BadParameter("Invalid URL: missing domain")

    return url


def generate_output_filename(url: str, title: Optional[str] = None) -> str:
    """Generate a sensible output filename from URL or title."""
    if title:
        # Clean title for filename
        clean = "".join(c if c.isalnum() or c in " -_" else "" for c in title)
        clean = clean.strip().replace(" ", "-")[:50]
        if clean:
            return f"{clean}.pdf"

    # Fall back to domain + path
    parsed = urlparse(url)
    domain = parsed.netloc.replace("www.", "").split(".")[0]
    path = parsed.path.strip("/").split("/")[-1] if parsed.path else "article"
    path = "".join(c if c.isalnum() or c in "-_" else "" for c in path)[:30]

    return f"{domain}-{path}.pdf" if path else f"{domain}-article.pdf"


def do_convert(
    url: str,
    output: Optional[Path],
    style: str,
    include_images: bool,
    pull_quotes: bool,
):
    """Core conversion logic."""
    # Validate URL
    try:
        url = validate_url(url)
    except typer.BadParameter as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)

    # Validate style
    if style not in ("magazine", "minimal"):
        console.print(f"[red]Error:[/red] Invalid style '{style}'. Use 'magazine' or 'minimal'.")
        raise typer.Exit(1)

    console.print(f"\n[bold]PrintFriendly[/bold] v{__version__}")
    console.print(f"Converting: [cyan]{url}[/cyan]\n")

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            # Step 1: Extract content
            task = progress.add_task("Fetching and extracting content...", total=None)
            extractor = ContentExtractor()
            content = extractor.extract(url, include_images=include_images)
            extractor.close()
            progress.update(task, completed=True)

            # Step 2: Analyze content
            task = progress.add_task("Analyzing article structure...", total=None)
            analyzer = ContentAnalyzer()
            analyzed = analyzer.analyze(content, num_pull_quotes=2 if pull_quotes else 0)
            progress.update(task, completed=True)

            # Step 3: Generate PDF
            task = progress.add_task("Generating PDF...", total=None)

            # Determine output path
            if output is None:
                output_dir = Path("output")
                output_dir.mkdir(exist_ok=True)
                output = output_dir / generate_output_filename(url, analyzed.title)

            renderer = PDFRenderer()
            renderer.render(
                analyzed,
                output_path=output,
                style=style,
                include_images=include_images,
                include_pull_quotes=pull_quotes,
            )
            progress.update(task, completed=True)

        # Success output
        console.print()
        console.print(f"[green]Success![/green] PDF saved to: [bold]{output}[/bold]")
        console.print()
        console.print(f"  Title: {analyzed.title}")
        if analyzed.author:
            console.print(f"  Author: {analyzed.author}")
        console.print(f"  Words: {analyzed.word_count:,}")
        console.print(f"  Reading time: ~{analyzed.reading_time_minutes} min")
        console.print(f"  Images: {len(content.images)}")
        console.print()

    except Exception as e:
        console.print(f"\n[red]Error:[/red] {e}")
        if "--verbose" in sys.argv or "-V" in sys.argv:
            import traceback
            console.print(traceback.format_exc())
        raise typer.Exit(1)


@app.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    url: Optional[str] = typer.Argument(
        None,
        help="URL of the newsletter/article to convert",
    ),
    output: Optional[Path] = typer.Option(
        None,
        "--output", "-o",
        help="Output PDF filename (default: auto-generated from title)",
    ),
    style: str = typer.Option(
        "magazine",
        "--style", "-s",
        help="Layout style: 'magazine' (full editorial) or 'minimal' (clean/simple)",
    ),
    include_images: bool = typer.Option(
        True,
        "--images/--no-images",
        help="Include images in the PDF",
    ),
    pull_quotes: bool = typer.Option(
        True,
        "--pull-quotes/--no-pull-quotes",
        help="Extract and display pull quotes",
    ),
    version: bool = typer.Option(
        None,
        "--version", "-v",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
):
    """
    Convert a web newsletter/article URL to a magazine-quality PDF.

    Example:
        printfriendly https://platformer.news/article-slug/
    """
    # If a subcommand is being invoked, skip
    if ctx.invoked_subcommand is not None:
        return

    # If no URL provided, show help
    if url is None:
        console.print(ctx.get_help())
        raise typer.Exit(0)

    do_convert(url, output, style, include_images, pull_quotes)


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", "--host", "-h", help="Host to bind to"),
    port: int = typer.Option(8000, "--port", "-p", help="Port to bind to"),
    reload: bool = typer.Option(False, "--reload", "-r", help="Enable auto-reload"),
):
    """
    Start the web interface for PrintFriendly.

    Opens a browser-based UI for converting articles.
    """
    import uvicorn

    console.print(f"\n[bold]PrintFriendly[/bold] Web Interface")
    console.print(f"Starting server at [cyan]http://{host}:{port}[/cyan]\n")

    uvicorn.run(
        "printfriendly.web:app",
        host=host,
        port=port,
        reload=reload,
    )


if __name__ == "__main__":
    app()
