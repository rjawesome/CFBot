import * as codeforces from 'codeforces-api'
import * as discord from 'discord.js'
import * as QuickChart from 'quickchart-js'
import fetch from 'node-fetch'

import { dbModel, dbDoc } from './models'
import { failEmbed, warnEmbed, successEmbed } from './utils'
import { success, info, warn, fail } from './logger'
import { problemArray, userScore } from './types'

let problems: dbDoc
let contest_number = 1

dbModel
  .find()
  .then((data) => {
    problems = data[0]
    success(`Got problems from database!`)
  })
  .catch((err) => fail(`Failed to get problems from database. Error: ${err}`))

export const getProfile = (
  msg: discord.Message,
  channel: discord.TextChannel
): void => {
  const user = extractArg(msg)
  info(`Getting CodeForces profile for user ${user}`)
  codeforces.user.info({ handles: user }, (err, data) => {
    if (err) {
      warn(`Error getting profile for ${user}`)
      channel.send(
        failEmbed(`.cf profile {user}`, `Error getting profile for ${user}`)
      )
      return
    }
    if (data[0].rating === undefined) {
      data[0].rating = 0
    }
    if (data[0].rank === undefined) {
      data[0].rank = 'newbie'
    }
    channel.send(
      successEmbed(
        user,
        `Profile: [${user}](https://codeforces.com/profile/${user})\nRating: ${data[0].rating}\nRank: ${data[0].rank}`
      ).setThumbnail(`https:${data[0].avatar}`)
    )
  })
}

export const getGraph = (
  msg: discord.Message,
  channel: discord.TextChannel
): void => {
  const user = extractArg(msg)
  info(`Getting CodeForces graph for user ${user}`)

  codeforces.user.rating({ handle: user }, async (err, data) => {
    if (err) {
      warn(`Failed to get CodeForces profile for user ${user}`)
      channel.send(failEmbed(`.cf graph {user}`, `Bad username: ${user}`))
    } else if (data.length === 0) {
      warn(`User ${user} does not have any contests`)
      channel.send(warnEmbed(user, `User ${user} does not have any contests`))
    } else {
      const chart = new QuickChart()
      const rand = Math.round(Math.random())

      const config = {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: user,
              backgroundColor: rand
                ? ['rgba(54, 162, 235, 0.5)']
                : ['rgba(255, 99, 132, 0.5)'],
              borderColor: rand
                ? ['rgba(54, 162, 235, 1.0)']
                : ['rgba(255, 99, 132, 1.0)'],
              data: [],
            },
          ],
        },
        options: {
          legend: {
            display: false,
          },
          elements: {
            point: {
              radius: 0,
            },
          },
          layout: {
            padding: {
              left: 30,
              right: 30,
              top: 30,
              bottom: 30,
            },
          },
          scales: {
            xAxes: [
              {
                display: false,
              },
            ],
          },
        },
      }

      let maxRating = 0
      data.forEach((d) => {
        const date = new Date(d.ratingUpdateTimeSeconds * 1000)
        const rating = d.newRating

        config.data.labels.push(date)
        config.data.datasets[0].data.push(rating)

        if (rating > maxRating) {
          maxRating = rating
        }
      })

      chart
        .setConfig(config)
        .setWidth('450px')
        .setHeight('340px')
        .setBackgroundColor('#fff')

      const image = await chart.getShortUrl()

      channel.send(
        successEmbed(user, `Max Rating: ${maxRating}`).setImage(image)
      )
    }
  })
}

export const getContest = (
  msg: discord.Message,
  channel: discord.TextChannel
): void => {
  const contest = extractArg(msg)
  codeforces.contest.standings({ contestId: parseInt(contest) }, (err, res) => {
    if (err) {
      warn(`Invalid contest ID: ${err}`)
      channel.send(
        failEmbed(`.cf contest {contest}`, `Invalid contest ID: ${contest}`)
      )
    } else {
      success(`Contest #${contest} successfully queried`)
      const main = `There are ${res.problems.length} problems in contest #${contest}:\n`
      let toSend = ''
      res.problems.forEach((problem) => {
        if (problem.points === undefined) {
          toSend += ` ${problem.index}: [${problem.name}](<https://codeforces.com/contest/${contest}/problem/${problem.index}>)\n`
        } else {
          toSend += ` ${problem.index} (${problem.points}): [${problem.name}](<https://codeforces.com/contest/${contest}/problem/${problem.index}>)\n`
        }
      })
      channel.send(successEmbed(main, toSend))
    }
  })
}

const extractArg = (msg: discord.Message) => {
  return msg.content.split(' ')[2]
}

export const startMatch = (
  msg: discord.Message,
  channel: discord.TextChannel
): void => {
  if (problems === undefined) {
    return
  }

  if (msg.content.split(' ').length < 5) {
    channel.send(
      failEmbed(`.cf match {div} {time} [users]`, `Invalid match command!`)
    )
    return
  }

  const div = msg.content.split(' ')[2]
  let time: number
  try {
    time = parseInt(msg.content.split(' ')[3])
    if (time < 1) {
      warn(`Invalid match: Time must be greater than one!`)
      channel.send(
        failEmbed(
          `.cf match {div} {time} [users]`,
          `Time must be greater than one!`
        )
      )
      return
    }
  } catch (e) {
    warn(`Invalid match: Failed to parse time!`)
    channel.send(
      failEmbed(`.cf match {div} {time} [users]`, `Failed to parse time!`)
    )
    return
  }

  const users = msg.content.split(' ').slice(4, msg.content.split(' ').length)
  if (users.length > 10) {
    channel.send(
      failEmbed(
        `.cf match {div} {time} [time]`,
        `Please specify less than 10 users!`
      )
    )
    return
  }

  let user_list = ''
  users.forEach((el) => (user_list += el + ';'))
  user_list = user_list.slice(0, user_list.length - 1)

  codeforces.user.info({ handles: user_list }, function (err, data) {
    if (err) {
      channel.send(
        failEmbed(
          `.cf match {div} {time} [users]`,
          `Invalid user in: ${user_list}`
        )
      )
      warn(`Failed to get usernames for match: Invalid user: ${user_list}`)
      return
    }
    const cont = contest_number
    contest_number++

    let contest_problems: problemArray[]
    switch (div) {
      case '1':
        contest_problems = getDiv1()
        break
      case '2':
        contest_problems = getDiv2()
        break
      case '3':
        contest_problems = getDiv3()
        break
      default:
        channel.send(
          failEmbed(`.cf match {div} {time} [users]`, 'Invalid division')
        )
        return
    }

    let toSendStr = ''
    contest_problems.forEach((element) => {
      toSendStr += element.toString() + '\n'
    })

    channel.send(successEmbed(`Starting contest #${cont}`, toSendStr))

    let time_passed = 0
    const start_time = new Date()

    const updateMatch = () => {
      const promises: Promise<any>[] = []
      users.forEach((user) => {
        promises.push(
          fetch(
            `https://codeforces.com/api/user.status?handle=${user}&from=1&count=5`
          )
        )
      })

      Promise.all(promises)
        .then((pData) => {
          const user_scores: userScore[] = []
          Promise.all(pData.map((dataaa) => dataaa.json())).then(
            (promiseData) => {
              promiseData.forEach((dataa) => {
                let score = 0
                dataa.result.forEach((submission) => {
                  const submitTime = new Date(
                    submission.creationTimeSeconds * 1000
                  )
                  if (submitTime < start_time) {
                    return
                  }
                  contest_problems.forEach((p, index) => {
                    if (
                      p.contestId === submission.problem.contestId &&
                      p.index === submission.problem.index &&
                      submission.verdict === 'OK'
                    ) {
                      score +=
                        p.origPoints -
                        3 *
                          Math.ceil(
                            (start_time.getSeconds() -
                              submitTime.getSeconds()) /
                              60
                          )
                      contest_problems.splice(index, 1)
                    }
                  })
                })
                if (data.length === 0) {
                  return
                }
                user_scores.push({
                  handle: dataa.result[0].author.members[0].handle,
                  score: score,
                })
              })
              let send_string = ''
              user_scores.sort((a, b) => b.score - a.score)
              user_scores.forEach((s) => {
                send_string += `\`${s.handle}\`: ${s.score} points\n`
              })

              channel.send(
                successEmbed(`Scoreboard update for match ${cont}`, send_string)
              )
            }
          )
        })
        .catch((err) => {
          console.log(err)
          channel.send(failEmbed(`the following is fax`, `ur bad: ${err}`))
        })

      contest_problems.forEach((elem) => (elem.points = elem.points - 3))

      toSendStr = ''
      contest_problems.forEach((element) => {
        toSendStr += element.toString() + '\n'
      })

      channel.send(
        successEmbed(`Updated Points for Contest #${cont}`, toSendStr)
      )

      time_passed++
      if (time_passed >= time) {
        channel.send(
          successEmbed(`Update for Contest #${cont}`, 'Match is over!')
        )
      } else {
        setTimeout(updateMatch, 60000) // change
      }
    }

    setTimeout(updateMatch, 60000)
  })
}

const getDiv1 = (): problemArray[] => {
  const div1Ratings = ['1600', '2000', '2400', '2800', '3200']
  const toSend: problemArray[] = []

  let points = 100
  div1Ratings.forEach((el) => {
    const random_index = Math.floor(Math.random() * problems[el].length)
    const problem = JSON.parse(JSON.stringify(problems[el][random_index]))
    toSend.push({
      toString: function () {
        return `${this.points}: [${this.problem['name']}](<https://codeforces.com/contest/${this.problem['contestId']}/problem/${this.problem['index']}>) [${this.problem['rating']}]`
      },
      contestId: problem['contestId'] as number,
      index: problem['index'] as string,
      points: points,
      problem: problem,
      origPoints: points,
    })
    points += 100
  })
  return toSend
}

const getDiv2 = (): problemArray[] => {
  const div2Ratings = ['800', '800', '1600', '2000', '2400']
  const toSend: problemArray[] = []

  let points = 100
  div2Ratings.forEach((el) => {
    const random_index = Math.floor(Math.random() * problems[el].length)
    const problem = JSON.parse(JSON.stringify(problems[el][random_index]))
    toSend.push({
      toString: function () {
        return `${this.points}: [${this.problem['name']}](<https://codeforces.com/contest/${this.problem['contestId']}/problem/${this.problem['index']}>) [${this.problem['rating']}]`
      },
      contestId: problem['contestId'] as number,
      index: problem['index'] as string,
      points: points,
      problem: problem,
      origPoints: points,
    })
    points += 100
  })
  return toSend
}

const getDiv3 = (): problemArray[] => {
  const div3Ratings = ['800', '800', '1200', '1200', '1600']
  const toSend: problemArray[] = []

  let points = 100
  div3Ratings.forEach((el) => {
    const random_index = Math.floor(Math.random() * problems[el].length)
    const problem = JSON.parse(JSON.stringify(problems[el][random_index]))
    toSend.push({
      toString: function () {
        return `${this.points}: [${this.problem['name']}](<https://codeforces.com/contest/${this.problem['contestId']}/problem/${this.problem['index']}>) [${this.problem['rating']}]`
      },
      contestId: problem['contestId'] as number,
      index: problem['index'] as string,
      points: points,
      problem: problem,
      origPoints: points,
    })
    points += 100
  })
  return toSend
}
