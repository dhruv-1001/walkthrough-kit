"""Steps the CCRS plan needs that a plan can't say on its own (`call: <name>`)."""


async def choose_workspace(page, kit, name: str) -> None:
    """Pick `name` on the workspace chooser, if it is showing. The entry is not
    always a <button> (sign-up and sign-in render it differently), so match its
    text, then make sure we actually left the chooser."""
    if "Choose a workspace" not in await page.inner_text("body"):
        return
    await page.get_by_text(name, exact=True).first.click()
    await page.wait_for_timeout(8000)
    if "Choose a workspace" in await page.inner_text("body"):
        raise RuntimeError(f"still on the workspace chooser after picking {name!r}")


async def management_mode(page, kit) -> None:
    """Open Management Studio. It opens once onboarding is finished: before that,
    /manage redirects to onboarding Home (some builds offer "Go to Management")."""
    await kit.goto(page, "/configurator/manage")
    if "/configurator/manage" not in page.url:
        if not await page.get_by_text("Go to Management").count():
            raise RuntimeError("Management Studio isn't open to this account yet: its workspace hasn't "
                               "finished onboarding (sign in with one that has)")
        await page.get_by_text("Go to Management").first.click()
        await page.wait_for_timeout(4000)
        await kit.goto(page, "/configurator/manage")
        if "/configurator/manage" not in page.url:
            raise RuntimeError(f"/configurator/manage redirected to {page.url}")
