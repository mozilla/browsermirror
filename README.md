# Browser Mirror

This is an experiment in session sharing through the browser.

The goal is primarily to explore the feasibility of a particular technique; it is well possible that this will not be a feasible manner of session sharing, but exactly *why* should be interesting.

## Implementation

This is not cooperative sharing, as in the case of Etherpad or Google Wave, but rather a master/client relationship.  The master browser is the active browser, and runs all the Javascript.  The mirror receives all the HTML (i.e., DOM elements) but no Javascript.  Anything that *happens* happens on the master browser and is relayed to the mirror.

The mirror in turn will capture events and relay them back to the master.  (This is where feasibility becomes questionable.)  So if for instance the mirror (client) user clicks on something, the specific element and the click event goes back to the master, where it is presented as though the master user clicked on the element.  If this in turn has visible side-effects, these are then transmitted back to the mirror.

Form inputs however are transmitted differently, in part because form status is not directly visible in the DOM, but also because the two browsers do not share a mouse cursor, place of focus, or typing cursor.  Instead these edits are allowed in the mirror and the resulting values transmitted back to the master.  There are problems however with things like an input that itself has a dynamic event handler, consider for instance `<input type="text" value="Search...">` which on focus removes the `Search...` text.  This only happens in response to a focus event, and the focus event does not happen on the master.  (Though perhaps it could be triggered, without actually triggering the master's true focus?)

Editing conflicts are most likely to occur within these input fields as well.  It is possible that a form of [Operational Transformation](http://en.wikipedia.org/wiki/Operational_transformation) could be used to specifically manage concurrent changes to form fields ([mobwrite](http://code.google.com/p/google-mobwrite/) could be used for this).  It is unclear to me how WYSIWYG editors will work; though since `contentEditable` is a fairly explicit feature we could special case this as well.

Notable iframes require additional work, but only insofar as compound pages must be handled.

Flash is a complete no-go.

## Communication

In addition to just sharing the same page, direct communication will be appropriate.  Simple chat is implemented, as is the concept of highlighting an element.  Because the two browsers are not necessarily rendering the same way (e.g., zoom levels, browser screen size, etc) all these operations have to happen on a DOM level.  I.e., you can't point at a *place*, you can only point at an *element* (though we find the element closest to your place, and possibly we could use an offset to get finer resolution).

There is a rough implementation of screen position, but I haven't figured out how to present that.  Also noting changes would probably be useful, so you can see that the other user is changing something (potentially off-screen for you)
.
## Bookmarklet or Plugin

Right now this is implemented as a bookmarklet.  This is relatively easy to work with and largely works.  It cannot feasibly handle iframes, nor can it handle the transition to another page (i.e., if you click a link you will lose your sharing).

Ultimately the master would probably be best as a plugin.  This could manage the transitions, and it's possible some things will be revealed which can be solved in a plugin but could not with in-page Javascript.

The mirror should probably not require any special browser functionality.  This would also make it easier to share a session with any user, regardless of what they are using.

## Initiating the sharing

Right now you are given a URL which the mirror user should go to, starting the sharing session.  Later it's possible F1 or an Open Web App service could facilitate the starting of a shared session, utilizing things like your social contacts.  This work seems to be progressing reasonably elsewhere, so this project won't attempt anything fancy.

## Native sharing

A web application *written to be shared* can in many ways be more elegant than what is implemented here.  For instance, it would be superior to share a Google Doc using their built-in sharing facilities than to use this technique.  The reliability of course will be much higher right now, but even if this project worked exactly as intended it would still be better to use the first-class editing concepts built into the web application, which understand intention far better than this project can.

One could imagine a formal way for a web page to indicate that it is shareable (and how), and for this to be a fallback when the page doesn't have a native sense of session sharing.

## Permissions

Right now the mirror client basically has permission to do anything (though certain things like file selection are not possible).  But it would be easy to give more limited permissions, for instance only permission to view a session, or to require confirmation before some actions take place (like browsing to another URL).  With a plugin it would also be possible to allow the remote client to select a file (possibly using for tech support).
